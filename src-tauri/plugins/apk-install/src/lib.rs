//! Installs a downloaded APK over the running app. Android does the actual
//! install: this opens its "Do you want to update this app?" screen.

use tauri::plugin::{Builder, TauriPlugin};
use tauri::Runtime;

#[cfg(target_os = "android")]
use tauri::Manager;

#[cfg(target_os = "android")]
struct Installer<R: Runtime>(tauri::plugin::PluginHandle<R>);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("apk-install")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle = _api.register_android_plugin("com.noodle.apkinstall", "ApkInstallPlugin")?;
                _app.manage(Installer(handle));
            }
            Ok(())
        })
        .build()
}

/// Opens the system installer for the APK at `path`. If Noodle isn't allowed
/// to install apps yet, opens that setting instead and returns an error saying so.
#[cfg(target_os = "android")]
pub fn install<R: Runtime>(app: &tauri::AppHandle<R>, path: &std::path::Path) -> Result<(), String> {
    let installer = app.try_state::<Installer<R>>().ok_or("The installer isn't ready")?;
    installer
        .0
        .run_mobile_plugin::<serde_json::Value>("install", serde_json::json!({ "path": path.to_string_lossy() }))
        .map(|_| ())
        .map_err(|e| e.to_string())
}
