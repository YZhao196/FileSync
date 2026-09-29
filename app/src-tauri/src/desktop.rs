//! Desktop-shell capabilities: the tray icon, notifications, launch-at-login,
//! and writing a downloaded file to disk.
//!
//! PLAN.md §11 calls the tray the reason this app runs at all — "did the backup
//! run, how full is the disk, are the services up" answered without opening
//! anything. The tray therefore carries live state rather than being a static
//! launcher, and its tooltip is kept current by `set_tray_status`.

use serde::Serialize;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_notification::NotificationExt;

pub const TRAY_ID: &str = "filesynapse-tray";

/// Whether the tray icon should be showing. Remembered in the process rather
/// than persisted: a tray the user hid should come back at next launch, since
/// nothing else tells them the app is running.
#[derive(Default)]
pub struct TrayState(pub Mutex<bool>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    platform: String,
}

#[tauri::command]
pub fn app_info(app: AppHandle) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS.to_string(),
    }
}

/// Writes bytes to a path the user chose in the save dialog.
///
/// This exists instead of the fs plugin because the app writes exactly one
/// kind of thing — the file the user just named — and granting a general
/// filesystem capability for that would be a much larger door than needed.
#[tauri::command]
pub fn write_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("Could not write {path}: {e}"))
}

/* ── Notifications ──────────────────────────────────────────────────────── */

#[tauri::command]
pub fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| format!("Could not show a notification: {e}"))
}

/* ── Launch at login ────────────────────────────────────────────────────── */

#[tauri::command]
pub fn get_autostart(app: AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch()
        .is_enabled()
        .map_err(|e| format!("Could not read the login item: {e}"))
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
    result.map_err(|e| format!("Could not change the login item: {e}"))
}

/* ── Tray ───────────────────────────────────────────────────────────────── */

/// Builds the tray icon and its menu.
///
/// The menu is deliberately three items. Everything else the app can do needs
/// the window, and a tray menu that mirrors the whole app is a worse version of
/// the app.
pub fn build_tray<R: Runtime>(app: &AppHandle<R>, enabled: bool) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open FileSynapse", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &separator, &quit])?;

    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(app.default_window_icon().cloned().ok_or_else(|| {
            tauri::Error::AssetNotFound("no default window icon to use for the tray".into())
        })?)
        .tooltip("FileSynapse")
        .menu(&menu)
        // The menu is the affordance on click for a status tray; left-click
        // brings the window up instead, which is what people try first.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    tray.set_visible(enabled)?;
    Ok(())
}

pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Whether the tray is showing.
///
/// Read from the tracked state rather than from the icon: `TrayIcon` on this
/// version has `set_visible` but no getter, and the state is what the user
/// actually chose. The tray is built visible at startup, so the initial `true`
/// is accurate whenever the app is running at all.
#[tauri::command]
pub fn get_tray_enabled(state: tauri::State<'_, TrayState>) -> Result<bool, String> {
    state.0.lock().map(|v| *v).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_tray_enabled(
    app: AppHandle,
    enabled: bool,
    state: tauri::State<'_, TrayState>,
) -> Result<(), String> {
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| "The tray icon is not available on this platform".to_string())?;
    tray.set_visible(enabled).map_err(|e| e.to_string())?;
    if let Ok(mut guard) = state.0.lock() {
        *guard = enabled;
    }
    Ok(())
}

/// Keeps the tray tooltip in step with the server. Called by the app whenever
/// the status panel refreshes, so the tray is right without polling on its own.
#[tauri::command]
pub fn set_tray_status(app: AppHandle, text: String) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_tooltip(Some(text)).map_err(|e| e.to_string())?;
    }
    Ok(())
}
