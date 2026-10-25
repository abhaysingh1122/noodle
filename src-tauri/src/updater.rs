//! One-click updates from the project's GitHub releases.
//!
//! Every push to `main` publishes a release (`v0.1.<build>`) with the
//! Windows installer attached. The app asks GitHub for the latest release,
//! and if it is newer, downloads the installer, runs it in passive mode
//! (progress bar only, no questions) and reopens Noodle afterwards.

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;

const LATEST_RELEASE_URL: &str = "https://api.github.com/repos/abhaysingh1122/noodle/releases/latest";
const USER_AGENT: &str = concat!("Noodle/", env!("CARGO_PKG_VERSION"));

#[derive(Debug, Deserialize)]
struct Release {
    tag_name: String,
    html_url: String,
    body: Option<String>,
    assets: Vec<Asset>,
}

#[derive(Debug, Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
    size: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    pub latest: String,
    pub available: bool,
    pub notes: String,
    pub page_url: String,
    /// The Windows setup `.exe` (or the `.apk` on Android), when the release has one.
    pub installer_url: Option<String>,
    pub installer_size: u64,
}

/// Parses "v0.1.12" or "0.1.12" into comparable numbers.
fn parse_version(v: &str) -> Option<Vec<u64>> {
    v.trim()
        .trim_start_matches('v')
        .split(['.', '-', '+'])
        .take(3)
        .map(|p| p.parse().ok())
        .collect()
}

pub fn is_newer(latest: &str, current: &str) -> bool {
    match (parse_version(latest), parse_version(current)) {
        (Some(l), Some(c)) => l > c,
        _ => false,
    }
}

fn pick_installer(assets: &[Asset]) -> Option<&Asset> {
    assets.iter().find(|a| {
        let n = a.name.to_lowercase();
        if cfg!(target_os = "android") {
            n.ends_with(".apk")
        } else {
            n.ends_with("-setup.exe") || (n.ends_with(".exe") && n.contains("setup"))
        }
    })
}

pub fn check(current: &str) -> Result<UpdateInfo, String> {
    let release: Release = ureq::get(LATEST_RELEASE_URL)
        .header("User-Agent", USER_AGENT)
        .header("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| format!("Couldn't reach GitHub: {e}"))?
        .body_mut()
        .read_json()
        .map_err(|e| format!("Unexpected answer from GitHub: {e}"))?;
    let installer = pick_installer(&release.assets);
    Ok(UpdateInfo {
        current: current.to_string(),
        latest: release.tag_name.trim_start_matches('v').to_string(),
        available: is_newer(&release.tag_name, current),
        notes: release.body.unwrap_or_default(),
        page_url: release.html_url,
        installer_url: installer.map(|a| a.browser_download_url.clone()),
        installer_size: installer.map_or(0, |a| a.size),
    })
}

/// Downloads the installer into the temp folder and returns its path.
pub fn download(url: &str, expected_size: u64) -> Result<PathBuf, String> {
    if !url.starts_with("https://github.com/abhaysingh1122/noodle/releases/download/") {
        return Err("Refusing to download an installer from an unexpected address".into());
    }
    let mut response = ureq::get(url)
        .header("User-Agent", USER_AGENT)
        .call()
        .map_err(|e| format!("Download failed: {e}"))?;
    let path = std::env::temp_dir().join("noodle-update-setup.exe");
    let mut file = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    let written = std::io::copy(&mut response.body_mut().as_reader(), &mut file).map_err(|e| format!("Download failed: {e}"))?;
    file.flush().map_err(|e| e.to_string())?;
    if expected_size > 0 && written != expected_size {
        return Err(format!("Download was incomplete ({written} of {expected_size} bytes)"));
    }
    Ok(path)
}

/// Starts the installer in passive mode and reopens Noodle when it is done.
/// The caller should quit the app right after, so files can be replaced.
#[cfg(windows)]
pub fn launch_installer(installer: &std::path::Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let app = std::env::current_exe().map_err(|e| e.to_string())?;
    // Wait for the installer, then start the freshly installed app.
    let script = format!(
        "Start-Sleep -Seconds 1; Start-Process -FilePath '{}' -ArgumentList '/P' -Wait; Start-Process -FilePath '{}'",
        installer.display().to_string().replace('\'', "''"),
        app.display().to_string().replace('\'', "''"),
    );
    std::process::Command::new("powershell")
        .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &script])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("Couldn't start the installer: {e}"))?;
    Ok(())
}

#[cfg(not(windows))]
pub fn launch_installer(_installer: &std::path::Path) -> Result<(), String> {
    Err("Automatic install is only available on Windows for now. Download the new version from the release page.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_versions() {
        assert!(is_newer("v0.1.12", "0.1.9"));
        assert!(is_newer("v0.2.0", "0.1.99"));
        assert!(!is_newer("v0.1.9", "0.1.9"));
        assert!(!is_newer("v0.1.8", "0.1.9"));
        assert!(!is_newer("nonsense", "0.1.0"));
    }

    #[test]
    fn picks_the_setup_exe() {
        let assets = vec![
            Asset { name: "Noodle_0.1.5_x64_en-US.msi".into(), browser_download_url: "msi".into(), size: 1 },
            Asset { name: "Noodle_0.1.5_x64-setup.exe".into(), browser_download_url: "exe".into(), size: 2 },
        ];
        assert_eq!(pick_installer(&assets).unwrap().browser_download_url, "exe");
    }

    #[test]
    fn refuses_foreign_download_urls() {
        assert!(download("https://example.com/evil.exe", 0).is_err());
    }
}
