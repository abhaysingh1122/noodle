mod updater;
mod vault;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::sync::{mpsc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use vault::{Backlink, Entry, Graph, SearchHit, Vault};

#[derive(Default)]
struct AppState {
    vault: Mutex<Option<Vault>>,
    watcher: Mutex<Option<RecommendedWatcher>>,
    /// Hash of the last content Noodle itself wrote to each note, so the
    /// watcher can ignore our own saves instead of reindexing on every one.
    own_writes: Mutex<HashMap<String, u64>>,
}

fn content_hash(content: &str) -> u64 {
    let mut h = DefaultHasher::new();
    content.hash(&mut h);
    h.finish()
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

/// How long the watcher waits for a burst of file events to settle.
const WATCH_DEBOUNCE: Duration = Duration::from_millis(250);

/// Watches the vault folder so edits made in other apps (or by sync tools
/// like Syncthing) show up immediately. Events are batched, our own saves
/// are skipped, and only the notes that changed are re-read.
fn watch(app: &AppHandle, root: std::path::PathBuf) -> notify::Result<RecommendedWatcher> {
    let (tx, rx) = mpsc::channel::<Vec<std::path::PathBuf>>();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        if !matches!(event.kind, notify::EventKind::Access(_)) {
            let _ = tx.send(event.paths);
        }
    })?;
    watcher.watch(&root, RecursiveMode::Recursive)?;

    let handle = app.clone();
    std::thread::spawn(move || {
        // Ends when the watcher (and with it the sender) is dropped.
        while let Ok(first) = rx.recv() {
            let mut batch: HashSet<std::path::PathBuf> = first.into_iter().collect();
            while let Ok(more) = rx.recv_timeout(WATCH_DEBOUNCE) {
                batch.extend(more);
            }
            let paths: Vec<String> = batch
                .iter()
                .filter_map(|p| p.strip_prefix(&root).ok())
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .filter(|p| !p.is_empty() && !p.split('/').any(|part| part.starts_with('.')))
                .collect();
            let changed = apply_changes(&handle, &root, paths);
            if !changed.is_empty() {
                let _ = handle.emit("vault-changed", ChangeEvent { paths: changed });
            }
        }
    });
    Ok(watcher)
}

/// Updates the index for a batch of changed paths and returns the ones that
/// were not simply Noodle's own saves.
fn apply_changes(app: &AppHandle, root: &std::path::Path, paths: Vec<String>) -> Vec<String> {
    let state = app.state::<AppState>();
    let own = state.own_writes.lock().map(|g| g.clone()).unwrap_or_default();
    let changed: Vec<String> = paths
        .into_iter()
        .filter(|rel| match own.get(rel) {
            Some(&hash) => std::fs::read_to_string(root.join(rel)).map_or(true, |c| content_hash(&c) != hash),
            None => true,
        })
        .collect();
    if changed.is_empty() {
        return changed;
    }
    if let Ok(mut guard) = state.vault.lock() {
        if let Some(v) = guard.as_mut() {
            // A folder moved or vanished: its notes went with it, so start over.
            let structural = changed.iter().any(|rel| !rel.to_lowercase().ends_with(".md") || root.join(rel).is_dir());
            if structural {
                v.reindex();
            } else {
                changed.iter().for_each(|rel| v.index_file(rel));
            }
        }
    }
    changed
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
    if let Ok(mut own) = state.own_writes.lock() {
        own.insert(path.clone(), content_hash(&content));
    }
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
