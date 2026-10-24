mod updater;
mod vault;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use vault::{Backlink, Entry, Graph, SearchHit, Vault};

#[derive(Default)]
struct AppState {
    vault: Mutex<Option<Vault>>,
    watcher: Mutex<Option<RecommendedWatcher>>,
}

type CmdResult<T> = Result<T, String>;

fn with_vault<T>(state: &State<AppState>, f: impl FnOnce(&mut Vault) -> CmdResult<T>) -> CmdResult<T> {
    let mut guard = state.vault.lock().map_err(|e| e.to_string())?;
    let vault = guard.as_mut().ok_or("No vault is open")?;
    f(vault)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultInfo {
    root: String,
    entries: Vec<Entry>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ChangeEvent {
    paths: Vec<String>,
}

/// Watches the vault folder so edits made in other apps (or by sync tools
/// like Syncthing) show up immediately.
fn watch(app: &AppHandle, root: std::path::PathBuf) -> notify::Result<RecommendedWatcher> {
    let handle = app.clone();
    let watch_root = root.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        if matches!(event.kind, notify::EventKind::Access(_)) {
            return;
        }
        let paths: Vec<String> = event
            .paths
            .iter()
            .filter_map(|p| p.strip_prefix(&watch_root).ok())
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .filter(|p| !p.split('/').any(|part| part.starts_with('.')))
            .collect();
        if paths.is_empty() {
            return;
        }
        let state = handle.state::<AppState>();
        if let Ok(mut guard) = state.vault.lock() {
            if let Some(v) = guard.as_mut() {
                v.reindex();
            }
        }
        let _ = handle.emit("vault-changed", ChangeEvent { paths });
    })?;
    watcher.watch(&root, RecursiveMode::Recursive)?;
    Ok(watcher)
}

#[tauri::command]
fn open_vault(app: AppHandle, state: State<AppState>, path: String) -> CmdResult<VaultInfo> {
    let vault = Vault::open(&path)?;
    let root = vault.root().to_path_buf();
    let info = VaultInfo { root: root.to_string_lossy().into_owned(), entries: vault.entries() };
    *state.vault.lock().map_err(|e| e.to_string())? = Some(vault);
    // A failed watcher is not fatal: the app still works, it just won't
    // notice outside edits until the next refresh.
    *state.watcher.lock().map_err(|e| e.to_string())? = watch(&app, root).ok();
    Ok(info)
}

#[tauri::command]
fn list_entries(state: State<AppState>) -> CmdResult<Vec<Entry>> {
    with_vault(&state, |v| Ok(v.entries()))
}

#[tauri::command]
fn read_note(state: State<AppState>, path: String) -> CmdResult<String> {
    with_vault(&state, |v| v.read(&path))
}

#[tauri::command]
fn write_note(state: State<AppState>, path: String, content: String) -> CmdResult<()> {
    with_vault(&state, |v| v.write(&path, &content))
}

#[tauri::command]
fn create_note(state: State<AppState>, path: String) -> CmdResult<String> {
    with_vault(&state, |v| v.create_note(&path))
}

#[tauri::command]
fn create_folder(state: State<AppState>, path: String) -> CmdResult<()> {
    with_vault(&state, |v| v.create_folder(&path))
}

#[tauri::command]
fn rename_entry(state: State<AppState>, from: String, to: String) -> CmdResult<()> {
    with_vault(&state, |v| v.rename(&from, &to))
}

#[tauri::command]
fn trash_entry(state: State<AppState>, path: String) -> CmdResult<()> {
    with_vault(&state, |v| v.trash(&path))
}

#[tauri::command]
fn resolve_link(state: State<AppState>, target: String) -> CmdResult<Option<String>> {
    with_vault(&state, |v| Ok(v.resolve_link(&target)))
}

#[tauri::command]
fn backlinks(state: State<AppState>, path: String) -> CmdResult<Vec<Backlink>> {
    with_vault(&state, |v| Ok(v.backlinks(&path)))
}

#[tauri::command]
fn search(state: State<AppState>, query: String) -> CmdResult<Vec<SearchHit>> {
    with_vault(&state, |v| Ok(v.search(&query, 200)))
}

#[tauri::command]
fn graph(state: State<AppState>) -> CmdResult<Graph> {
    with_vault(&state, |v| Ok(v.graph()))
}

#[tauri::command]
fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
async fn check_update(app: AppHandle) -> CmdResult<updater::UpdateInfo> {
    let current = app.package_info().version.to_string();
    tauri::async_runtime::spawn_blocking(move || updater::check(&current))
        .await
        .map_err(|e| e.to_string())?
}

/// Downloads and starts the new installer, then quits so it can replace
/// the app. The installer reopens Noodle when it finishes.
#[tauri::command]
async fn install_update(app: AppHandle, url: String, size: u64) -> CmdResult<()> {
    let installer = tauri::async_runtime::spawn_blocking(move || updater::download(&url, size))
        .await
        .map_err(|e| e.to_string())??;
    updater::launch_installer(&installer)?;
    app.exit(0);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            open_vault,
            list_entries,
            read_note,
            write_note,
            create_note,
            create_folder,
            rename_entry,
            trash_entry,
            resolve_link,
            backlinks,
            search,
            graph,
            app_version,
            check_update,
            install_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running Noodle");
}
