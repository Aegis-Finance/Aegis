use crate::security::{
    enforce_listen_host, order_rpc_upstreams, redact_error, safe_circuit_path,
    verify_circuit_integrity, SecurityConfig,
};
use anyhow::{bail, Context, Result};
use axum::{
    extract::{DefaultBodyLimit, Path, State},
    http::{header, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    net::SocketAddr,
    path::{Path as FsPath, PathBuf},
    sync::Arc,
};
use tokio::net::TcpListener;
use tracing::{info, warn};

static ALLOWED_RPC: std::sync::LazyLock<HashSet<&'static str>> = std::sync::LazyLock::new(|| {
    HashSet::from([
        "eth_chainId",
        "eth_blockNumber",
        "eth_call",
        "eth_estimateGas",
        "eth_gasPrice",
        "eth_getBalance",
        "eth_getBlockByNumber",
        "eth_getBlockByHash",
        "eth_getCode",
        "eth_getLogs",
        "eth_getStorageAt",
        "eth_getTransactionByHash",
        "eth_getTransactionCount",
        "eth_getTransactionReceipt",
        "eth_sendRawTransaction",
        "net_version",
        "web3_clientVersion",
    ])
});

const MAX_BATCH: usize = 32;

#[derive(Debug, Deserialize, Clone)]
pub struct RpcConfig {
    pub listen: String,
    pub port: u16,
    pub upstreams: Vec<String>,
    #[serde(rename = "timeoutMs")]
    pub timeout_ms: u64,
}

#[derive(Debug, Deserialize, Clone, Default)]
pub struct IntegrityConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub sha256: HashMap<String, String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct CircuitsConfig {
    pub listen: String,
    pub port: u16,
    pub root: String,
    #[serde(default)]
    pub integrity: IntegrityConfig,
}

#[derive(Debug, Deserialize, Clone)]
pub struct AppConfig {
    pub rpc: RpcConfig,
    pub circuits: CircuitsConfig,
    #[serde(default)]
    pub security: SecurityConfig,
}

impl AppConfig {
    pub fn security(&self) -> SecurityConfig {
        self.security.clone().merged()
    }
}

#[derive(Clone)]
struct RpcState {
    upstreams: Vec<String>,
    timeout_ms: u64,
    security: SecurityConfig,
    client: reqwest::Client,
}

#[derive(Clone)]
struct CircuitsState {
    root: PathBuf,
    integrity: IntegrityConfig,
}

pub fn resolve_shared_config(base: &FsPath) -> Result<AppConfig> {
    let user = base.join("config.json");
    let example = base.join("config.example.json");
    let path = if user.exists() { user } else { example };
    let raw = std::fs::read_to_string(&path)
        .with_context(|| format!("read config {}", path.display()))?;
    Ok(serde_json::from_str(&raw)?)
}

pub fn resolve_circuits_root(base: &FsPath, cfg: &CircuitsConfig) -> PathBuf {
    let p = PathBuf::from(&cfg.root);
    if p.is_absolute() {
        p
    } else {
        base.join(p)
    }
}

fn validate_single(body: &Value) -> Result<(), (StatusCode, Value)> {
    let obj = body.as_object().ok_or((
        StatusCode::BAD_REQUEST,
        json!({"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"Invalid JSON-RPC body"}}),
    ))?;
    if obj.get("jsonrpc").and_then(|v| v.as_str()) != Some("2.0") {
        return Err((
            StatusCode::BAD_REQUEST,
            json!({"jsonrpc":"2.0","id":obj.get("id").cloned().unwrap_or(Value::Null),"error":{"code":-32600,"message":"jsonrpc must be 2.0"}}),
        ));
    }
    let method = obj
        .get("method")
        .and_then(|v| v.as_str())
        .ok_or((
            StatusCode::BAD_REQUEST,
            json!({"jsonrpc":"2.0","id":obj.get("id").cloned().unwrap_or(Value::Null),"error":{"code":-32600,"message":"missing method"}}),
        ))?;
    if !ALLOWED_RPC.contains(method) {
        return Err((
            StatusCode::FORBIDDEN,
            json!({"jsonrpc":"2.0","id":obj.get("id").cloned().unwrap_or(Value::Null),"error":{"code":403,"message":format!("RPC method not allowed: {method}")}}),
        ));
    }
    Ok(())
}

fn validate_envelope(body: &Value) -> Result<(), (StatusCode, Value)> {
    if body.is_array() {
        let arr = body.as_array().unwrap();
        if arr.is_empty() {
            return Err((
                StatusCode::BAD_REQUEST,
                json!({"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"Empty batch"}}),
            ));
        }
        if arr.len() > MAX_BATCH {
            return Err((
                StatusCode::BAD_REQUEST,
                json!({"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":format!("Batch exceeds {MAX_BATCH}")}}),
            ));
        }
        for item in arr {
            validate_single(item)?;
        }
        return Ok(());
    }
    validate_single(body)
}

async fn try_upstream(
    state: &RpcState,
    target: &str,
    body: &Value,
) -> Result<(StatusCode, Value), String> {
    let resp = state
        .client
        .post(target)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(body)
        .timeout(std::time::Duration::from_millis(state.timeout_ms))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let text = resp.text().await.map_err(|e| e.to_string())?;
    let value: Value = serde_json::from_str(&text)
        .map_err(|_| "Upstream returned non-JSON".to_string())?;
    Ok((status, value))
}

async fn rpc_handler(State(state): State<Arc<RpcState>>, Json(body): Json<Value>) -> Response {
    if let Err((status, err)) = validate_envelope(&body) {
        return (status, Json(err)).into_response();
    }

    if state.upstreams.is_empty() {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "jsonrpc": "2.0",
                "id": null,
                "error": { "code": -32603, "message": "No RPC upstream configured" }
            })),
        )
            .into_response();
    }

    let mut last_err = "Upstream unavailable".to_string();
    for target in &state.upstreams {
        match try_upstream(&state, target, &body).await {
            Ok((status, value)) => return (status, Json(value)).into_response(),
            Err(e) => {
                last_err = redact_error(&state.security, &e);
                if state.security.is_operational() {
                    warn!("rpc upstream failed (detail suppressed in responses)");
                }
            }
        }
    }

    (
        StatusCode::BAD_GATEWAY,
        Json(json!({
            "jsonrpc": "2.0",
            "id": null,
            "error": { "code": -32603, "message": last_err }
        })),
    )
        .into_response()
}

async fn method_not_allowed() -> impl IntoResponse {
    (StatusCode::METHOD_NOT_ALLOWED, "Method Not Allowed")
}

async fn circuit_handler(
    State(state): State<Arc<CircuitsState>>,
    method: Method,
    Path(tail): Path<String>,
) -> Response {
    if method != Method::GET && method != Method::HEAD {
        return StatusCode::METHOD_NOT_ALLOWED.into_response();
    }

    let Some(abs) = safe_circuit_path(&state.root, &tail) else {
        return StatusCode::FORBIDDEN.into_response();
    };

    if state.integrity.enabled {
        let rel_key = abs
            .strip_prefix(&state.root)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        if let Err(e) = verify_circuit_integrity(&abs, &rel_key, &state.integrity.sha256) {
            warn!("{e:#}");
            return (StatusCode::CONFLICT, "Integrity mismatch").into_response();
        }
    }

    let meta = match std::fs::metadata(&abs) {
        Ok(m) if m.is_file() => m,
        _ => return StatusCode::NOT_FOUND.into_response(),
    };

    if method == Method::HEAD {
        return (
            StatusCode::OK,
            [
                (header::CONTENT_LENGTH, HeaderValue::from(meta.len())),
                (
                    header::CONTENT_TYPE,
                    HeaderValue::from_static("application/octet-stream"),
                ),
            ],
        )
            .into_response();
    }

    match tokio::fs::read(&abs).await {
        Ok(bytes) => (
            StatusCode::OK,
            [
                (
                    header::CONTENT_TYPE,
                    HeaderValue::from_static("application/octet-stream"),
                ),
                (header::CACHE_CONTROL, HeaderValue::from_static("no-store")),
            ],
            bytes,
        )
            .into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

pub async fn start_rpc(cfg: RpcConfig, security: SecurityConfig) -> Result<()> {
    enforce_listen_host(&cfg.listen, &security)?;
    let upstreams = order_rpc_upstreams(&cfg.upstreams, &security);
    if upstreams.is_empty() {
        bail!(
            "no RPC upstreams available: run a local Sonic node on 127.0.0.1:8545 \
             or set security.allowPublicRpcUpstreams=true (not recommended)"
        );
    }

    let client = reqwest::Client::builder()
        .user_agent("aegis-local-rpc")
        .redirect(reqwest::redirect::Policy::none())
        .build()?;

    let state = Arc::new(RpcState {
        upstreams,
        timeout_ms: cfg.timeout_ms,
        security: security.clone(),
        client,
    });

    let limit = security.max_rpc_body_bytes;
    let app = Router::new()
        .route("/", post(rpc_handler).fallback(method_not_allowed))
        .layer(DefaultBodyLimit::max(limit))
        .with_state(state);

    let addr: SocketAddr = format!("{}:{}", cfg.listen, cfg.port)
        .parse()
        .context("rpc listen address")?;
    let listener = TcpListener::bind(addr).await?;
    info!(
        "Aegis RPC on http://{addr} (profile={}, upstreams={})",
        security.profile,
        if security.allow_public_rpc_upstreams {
            "local+public"
        } else {
            "local-only"
        }
    );
    axum::serve(listener, app).await?;
    Ok(())
}

pub async fn start_circuits(cfg: CircuitsConfig, root: PathBuf, security: SecurityConfig) -> Result<()> {
    enforce_listen_host(&cfg.listen, &security)?;
    std::fs::create_dir_all(&root).ok();

    let state = Arc::new(CircuitsState {
        root: root.clone(),
        integrity: cfg.integrity.clone(),
    });

    let app = Router::new()
        .route("/circuits/{*tail}", get(circuit_handler).head(circuit_handler))
        .with_state(state);

    let addr: SocketAddr = format!("{}:{}", cfg.listen, cfg.port)
        .parse()
        .context("circuits listen address")?;
    let listener = TcpListener::bind(addr).await?;
    info!(
        "Aegis circuits on http://{addr}/circuits/ (integrity={})",
        cfg.integrity.enabled
    );
    axum::serve(listener, app).await?;
    Ok(())
}

pub async fn start_engines(shared_dir: PathBuf, app_root: PathBuf) -> Result<()> {
    let cfg = resolve_shared_config(&shared_dir)?;
    let security = cfg.security();
    let circuits_root = resolve_circuits_root(&app_root, &cfg.circuits);

    let rpc_cfg = cfg.rpc.clone();
    let circuits_cfg = cfg.circuits.clone();
    let sec_rpc = security.clone();
    let sec_circuits = security.clone();

    tokio::spawn(async move {
        if let Err(e) = start_rpc(rpc_cfg, sec_rpc).await {
            tracing::error!("rpc server: {e:#}");
        }
    });

    tokio::spawn(async move {
        if let Err(e) = start_circuits(circuits_cfg, circuits_root, sec_circuits).await {
            tracing::error!("circuits server: {e:#}");
        }
    });

    Ok(())
}
