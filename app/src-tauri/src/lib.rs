//! FileSynapse desktop shell.
//!
//! The window draws no chrome of its own: the platform's decorations supply the
//! title bar, close button and drag region, and the app's own UI fills the rest.
//!
//! Everything the frontend cannot do from a webview lives in the sibling
//! modules — HTTP without CORS (`http`), the keychain (`credentials`), machine
//! inspection (`preflight`), the provisioning runner (`provision`) and the
//! desktop affordances (`desktop`). The browser build uses the same TypeScript
//! against a bridge that degrades each one.

mod credentials;
mod desktop;
mod http;
mod preflight;
mod provision;

use desktop::TrayState;
use provision::ProvisionState;
// `get_webview_window` lives on the Manager trait, so it must be in scope for
// the setup hook to hide the window when autostart launches it hidden.
use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Registered first: it has to see every launch before anything else
        // initialises. A second launch focuses the running window rather than
        // producing a second tray icon and a second backup watcher.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            desktop::show_main_window(app);
        }))
        // Backs `native/bridge.ts`: folder dialogs and "open in system explorer".
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // The http plugin is registered so its Rust-side reqwest client is
        // available (and its capability scope validated), even though requests
        // go through our own `http_request` command rather than the plugin's
        // built-in JS fetch wrapper.
        .plugin(tauri_plugin_http::init())
        // Launch at login. The arg asks a re-launch to start hidden, which is
        // what a tray-resident app should do.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .manage(TrayState(std::sync::Mutex::new(true)))
        .manage(ProvisionState::default())
        .setup(|app| {
            // Default on: the tray is the point of the desktop app, and a
            // hidden-by-default tray would make the app look like it did not
            // start. Settings can turn it off.
            desktop::build_tray(app.handle(), true)?;

            // The autostart entry passes `--hidden`, so signing in starts the
            // app in the tray rather than throwing a window over whatever you
            // were doing. Without this the flag would be decoration.
            if std::env::args().any(|a| a == "--hidden") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            Ok(())
        })
        // Closing the window hides it while the tray is showing, so backup
        // watching keeps running. With the tray turned off, close means quit.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let tray_on = window
                    .state::<TrayState>()
                    .0
                    .lock()
                    .map(|v| *v)
                    .unwrap_or(false);
                if tray_on {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            http::http_request,
            credentials::store_credential,
            credentials::get_credential,
            desktop::app_info,
            desktop::write_file,
            desktop::notify,
            desktop::get_autostart,
            desktop::set_autostart,
            desktop::get_tray_enabled,
            desktop::set_tray_enabled,
            desktop::set_tray_status,
            preflight::preflight,
            provision::start_provision,
            provision::provision_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running FileSynapse");
}
