use anyhow::{bail, Result};
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use url::Url;

#[derive(Debug, Clone, serde::Deserialize)]
pub struct SecurityConfig {
    #[serde(default = "default_profile")]
    pub profile: String,
    #[serde(default)]
    pub allow_public_rpc_upstreams: bool,
    #[serde(rename = "allowPublicRpcUpstreams", default)]
    pub allow_public_rpc_upstreams_camel: Option<bool>,
    #[serde(default = "default_true")]
    pub require_loopback_bind: bool,
    #[serde(rename = "requireLoopbackBind", default)]
    pub require_loopback_bind_camel: Option<bool>,
    #[serde(default = "default_max_body")]
    pub max_rpc_body_bytes: usize,
    #[serde(rename = "maxRpcBodyBytes", default)]
    pub max_rpc_body_bytes_camel: Option<usize>,
    #[serde(default = "default_true")]
    pub redact_upstream_errors: bool,
    #[serde(rename = "redactUpstreamErrors", default)]
    pub redact_upstream_errors_camel: Option<bool>,
    #[serde(default = "default_min_log")]
    pub min_log_level: String,
    #[serde(rename = "minLogLevel", default)]
    pub min_log_level_camel: Option<String>,
}

impl SecurityConfig {
    pub fn merged(self) -> Self {
        let allow_public_rpc_upstreams = self
            .allow_public_rpc_upstreams_camel
            .unwrap_or(self.allow_public_rpc_upstreams);
        let require_loopback_bind = self
            .require_loopback_bind_camel
            .unwrap_or(self.require_loopback_bind);
        let max_rpc_body_bytes = self
            .max_rpc_body_bytes_camel
            .unwrap_or(self.max_rpc_body_bytes);
        let redact_upstream_errors = self
            .redact_upstream_errors_camel
            .unwrap_or(self.redact_upstream_errors);
        let min_log_level = self
            .min_log_level_camel
            .unwrap_or(self.min_log_level);
        Self {
            allow_public_rpc_upstreams,
            require_loopback_bind,
            max_rpc_body_bytes,
            redact_upstream_errors,
            min_log_level,
            profile: self.profile,
            allow_public_rpc_upstreams_camel: None,
            require_loopback_bind_camel: None,
            max_rpc_body_bytes_camel: None,
            redact_upstream_errors_camel: None,
            min_log_level_camel: None,
        }
    }

    pub fn is_operational(&self) -> bool {
        self.profile.eq_ignore_ascii_case("operational")
    }
}

impl Default for SecurityConfig {
    fn default() -> Self {
        Self {
            profile: default_profile(),
            allow_public_rpc_upstreams: false,
            allow_public_rpc_upstreams_camel: None,
            require_loopback_bind: true,
            require_loopback_bind_camel: None,
            max_rpc_body_bytes: default_max_body(),
            max_rpc_body_bytes_camel: None,
            redact_upstream_errors: true,
            redact_upstream_errors_camel: None,
            min_log_level: default_min_log(),
            min_log_level_camel: None,
        }
    }
}

fn default_profile() -> String {
    "operational".into()
}
fn default_true() -> bool {
    true
}
fn default_max_body() -> usize {
    921_600
}
fn default_min_log() -> String {
    "warn".into()
}

pub fn enforce_listen_host(listen: &str, security: &SecurityConfig) -> Result<()> {
    if !security.require_loopback_bind {
        return Ok(());
    }
    if listen == "127.0.0.1" || listen == "::1" || listen == "localhost" {
        return Ok(());
    }
    bail!(
        "security.requireLoopbackBind: RPC/circuits must listen on loopback (got {listen}). \
         Set requireLoopbackBind=false only if you accept LAN exposure."
    );
}

pub fn is_loopback_upstream(url: &str) -> bool {
    Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h == "127.0.0.1" || h.eq_ignore_ascii_case("localhost")))
        .unwrap_or(false)
}

pub fn order_rpc_upstreams(upstreams: &[String], security: &SecurityConfig) -> Vec<String> {
    let mut local = Vec::new();
    let mut remote = Vec::new();
    for u in upstreams {
        if is_loopback_upstream(u) {
            local.push(u.clone());
        } else if security.allow_public_rpc_upstreams {
            remote.push(u.clone());
        }
    }
    local.extend(remote);
    local
}

pub fn safe_circuit_path(root: &Path, request_path: &str) -> Option<PathBuf> {
    let tail = request_path
        .trim_start_matches("/circuits/")
        .trim_start_matches("/circuits")
        .trim_start_matches('/');
    if tail.is_empty() || tail.contains('\0') {
        return None;
    }
    let rel = Path::new(tail);
    for c in rel.components() {
        if matches!(c, Component::ParentDir | Component::RootDir | Component::Prefix(_)) {
            return None;
        }
    }
    let abs = root.join(rel);
    let canon_root = root.canonicalize().ok()?;
    let canon_abs = abs.canonicalize().ok()?;
    if canon_abs.starts_with(&canon_root) {
        Some(canon_abs)
    } else {
        None
    }
}

pub fn verify_circuit_integrity(
    path: &Path,
    rel_key: &str,
    expected: &HashMap<String, String>,
) -> Result<()> {
    let Some(expected_hash) = expected.get(rel_key) else {
        return Ok(());
    };
    let bytes = std::fs::read(path)?;
    let digest = sha256_hex(&bytes);
    if digest.eq_ignore_ascii_case(expected_hash) {
        Ok(())
    } else {
        bail!("circuit integrity mismatch for {rel_key}")
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    hex::encode(h.finalize())
}

pub fn redact_error(security: &SecurityConfig, detail: &str) -> String {
    if security.redact_upstream_errors {
        "Upstream unavailable".into()
    } else {
        detail.to_string()
    }
}
