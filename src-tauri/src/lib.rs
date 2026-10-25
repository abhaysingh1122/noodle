mod http_api;
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
    /// The local HTTP API, when it is switched on.
    api: Mutex<Option<http_api::ApiServer>>,
}

/// Gives the HTTP API access to whatever vault is open in the window.
struct AppAccess(AppHandle);

impl http_api::VaultAccess for AppAccess {
    fn with_vault<T>(&self, f: impl FnOnce(&mut Vault) -> CmdResult<T>) -> CmdResult<T> {
        with_vault(&self.0.state::<AppState>(), f)
    }
    fn version(&self) -> String {
        self.0.package_info().version.to_string()
    }
}

fn content_hash(content: &str) -> u64 {
    content_hash_bytes(content.as_bytes())
}

fn content_hash_bytes(bytes: &[u8]) -> u64 {
    let mut h = DefaultHasher::new();
    bytes.hash(&mut h);
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
    // Let the window show images stored in this vault (banners, badges, pictures).
    let _ = app.asset_protocol_scope().allow_directory(&root, true);
    *state.vault.lock().map_err(|e| e.to_string())? = Some(vault);
    // A failed watcher is not fatal: the app still works, it just won't
    // notice outside edits until the next refresh.
    *state.watcher.lock().map_err(|e| e.to_string())? = watch(&app, root).ok();
    Ok(info)
}

/// The vault the phone app uses: a "Noodle" folder in the app's own storage.
#[tauri::command]
fn default_vault(app: AppHandle) -> CmdResult<String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("Noodle");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Renames the open vault's folder itself, then reopens it under the new name.
#[tauri::command]
fn rename_vault(app: AppHandle, state: State<AppState>, name: String) -> CmdResult<VaultInfo> {
    let root = with_vault(&state, |v| Ok(v.root().to_path_buf()))?;
    let clean: String = name.trim().chars().filter(|c| !r#"\/:*?"<>|"#.contains(*c)).collect();
    let clean = clean.trim();
    if clean.is_empty() {
        return Err("Give the vault a name".into());
    }
    let parent = root.parent().ok_or("This folder can't be renamed")?;
    let dst = parent.join(clean);
    if dst == root {
        return open_vault(app, state, root.to_string_lossy().into_owned());
    }
    if dst.exists() {
        return Err(format!("There is already a folder called {clean} next to this one"));
    }
    // Let go of the folder first: Windows won't rename a folder that is being watched.
    *state.watcher.lock().map_err(|e| e.to_string())? = None;
    *state.vault.lock().map_err(|e| e.to_string())? = None;
    if let Err(e) = std::fs::rename(&root, &dst) {
        open_vault(app, state, root.to_string_lossy().into_owned())?;
        return Err(format!("Couldn't rename the vault: {e}"));
    }
    open_vault(app, state, dst.to_string_lossy().into_owned())
}

/// Makes a new, empty vault folder: inside `parent` when given, otherwise in the user's
/// Documents (on phones, the app's own storage). Picks "Name 2", "Name 3"… if the name is taken.
#[tauri::command]
fn create_vault(app: AppHandle, name: String, parent: Option<String>) -> CmdResult<String> {
    let parent = match parent {
        Some(p) => std::path::PathBuf::from(p),
        // Phones keep vaults inside the app's own storage.
        None if cfg!(mobile) => app.path().app_data_dir().map_err(|e| e.to_string())?.join("Vaults"),
        None => app.path().document_dir().or_else(|_| app.path().home_dir()).map_err(|e| e.to_string())?,
    };
    let clean: String = name.trim().chars().filter(|c| !r#"\/:*?"<>|"#.contains(*c)).collect();
    let clean = if clean.trim().is_empty() { "Noodle".to_string() } else { clean.trim().to_string() };
    let mut dir = parent.join(&clean);
    let mut n = 2;
    while dir.exists() {
        dir = parent.join(format!("{clean} {n}"));
        n += 1;
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create {}: {e}", dir.display()))?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Hashes of every note, folder and attachment, for cloud sync.
#[tauri::command]
async fn sync_snapshot(app: AppHandle) -> CmdResult<Vec<vault::SyncItem>> {
    tauri::async_runtime::spawn_blocking(move || with_vault(&app.state::<AppState>(), |v| Ok(v.sync_snapshot())))
        .await
        .map_err(|e| e.to_string())?
}

/// Raw bytes of a vault file (attachments), for uploading.
#[tauri::command]
fn read_bytes(state: State<AppState>, path: String) -> CmdResult<tauri::ipc::Response> {
    with_vault(&state, |v| v.read_bytes(&path)).map(tauri::ipc::Response::new)
}

/// Writes raw bytes to an exact vault path (path in the x-path header), for downloads.
#[tauri::command]
fn write_bytes(state: State<AppState>, request: tauri::ipc::Request) -> CmdResult<()> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected raw bytes".into());
    };
    let path = request.headers().get("x-path").and_then(|h| h.to_str().ok()).ok_or("Missing x-path header")?;
    let path = http_api::percent_decode(path);
    if let Ok(mut own) = state.own_writes.lock() {
        own.insert(path.clone(), content_hash_bytes(bytes));
    }
    with_vault(&state, |v| v.write_bytes(&path, bytes))
}

/// Copies an image chosen on the computer into the vault's attachments.
#[tauri::command]
fn import_image(state: State<AppState>, source: String) -> CmdResult<String> {
    with_vault(&state, |v| v.import_file(std::path::Path::new(&source)))
}

/// Saves pasted image bytes (sent raw, with the file name in a header).
#[tauri::command]
fn save_attachment(state: State<AppState>, request: tauri::ipc::Request) -> CmdResult<String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected raw image bytes".into());
    };
    let name = request.headers().get("x-file-name").and_then(|h| h.to_str().ok()).unwrap_or("pasted.png");
    with_vault(&state, |v| v.save_attachment(name, bytes))
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

/// Starts, restarts or stops the local HTTP API. Returns the port it listens on.
/// `lan` lets other devices on the same Wi-Fi reach it too.
#[tauri::command]
fn configure_api(app: AppHandle, state: State<AppState>, enabled: bool, port: u16, key: String, lan: bool) -> CmdResult<Option<u16>> {
    let mut slot = state.api.lock().map_err(|e| e.to_string())?;
    if let Some(old) = slot.take() {
        old.stop();
    }
    if !enabled {
        return Ok(None);
    }
    // The old listener may take a moment to let go of the port.
    let mut attempt = 0;
    let server = loop {
        match http_api::start(AppAccess(app.clone()), port, key.clone(), lan) {
            Ok(server) => break server,
            Err(e) if attempt >= 10 => return Err(e),
            Err(_) => {
                attempt += 1;
                std::thread::sleep(Duration::from_millis(100));
            }
        }
    };
    let port = server.port;
    *slot = Some(server);
    Ok(Some(port))
}

/// This device's address on the local network, for reaching the API from another device.
#[tauri::command]
fn local_ip() -> Option<String> {
    // Connecting a UDP socket sends nothing; it just picks the outgoing interface.
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    Some(socket.local_addr().ok()?.ip().to_string())
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
    // Android installs apps itself: download the new APK, then open the
    // system's "update this app?" screen for it.
    #[cfg(target_os = "android")]
    {
        let path = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("updates").join("noodle-update.apk");
        let apk = tauri::async_runtime::spawn_blocking(move || updater::download(&url, size, path))
            .await
            .map_err(|e| e.to_string())??;
        tauri_plugin_apk_install::install(&app, &apk)
    }
    #[cfg(not(target_os = "android"))]
    {
        let path = std::env::temp_dir().join("noodle-update-setup.exe");
        let installer = tauri::async_runtime::spawn_blocking(move || updater::download(&url, size, path))
            .await
            .map_err(|e| e.to_string())??;
        updater::launch_installer(&installer)?;
        app.exit(0);
        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_apk_install::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            open_vault,
            create_vault,
            rename_vault,
            default_vault,
            import_image,
            sync_snapshot,
            read_bytes,
            write_bytes,
            save_attachment,
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
            configure_api,
            local_ip,
            app_version,
            check_update,
            install_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running Noodle");
}
