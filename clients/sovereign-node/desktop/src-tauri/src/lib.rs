mod security;
mod server;

use std::path::PathBuf;
use tauri::Manager;

fn resolve_shared_dir(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(resource) = app.path().resource_dir() {
        let bundled = resource.join("shared");
        if bundled.join("config.example.json").exists() || bundled.join("config.json").exists() {
            return bundled;
        }
    }

    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../shared")
}

fn resolve_app_root(shared_dir: &PathBuf) -> PathBuf {
    shared_dir
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| shared_dir.clone())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            let shared_dir = resolve_shared_dir(&handle);

            let log_filter = server::resolve_shared_config(&shared_dir)
                .map(|c| c.security().min_log_level)
                .unwrap_or_else(|_| "warn".into());

            tracing_subscriber::fmt()
                .with_env_filter(format!("{log_filter},hyper=warn,reqwest=warn"))
                .with_target(false)
                .init();

            let app_root = resolve_app_root(&shared_dir);
            tauri::async_runtime::spawn(async move {
                if let Err(e) = server::start_engines(shared_dir, app_root).await {
                    tracing::error!("engines: {e:#}");
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running Aegis");
}
