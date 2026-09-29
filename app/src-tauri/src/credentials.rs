//! Credentials in the OS keychain.
//!
//! PLAN.md §11 is explicit that secrets go in Keychain / Credential Manager /
//! libsecret and never in a plaintext config file. Nothing here writes to disk;
//! the `keyring` crate owns the platform differences.

const KEYCHAIN_SERVICE: &str = "filesynapse";

/// Stores or deletes a credential.
///
/// `value: null` (or empty) removes the entry rather than storing a blank, so
/// clearing a field in Settings actually clears it.
#[tauri::command]
pub fn store_credential(account: String, value: Option<String>) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &account)
        .map_err(|e| format!("Keychain entry error: {e}"))?;
    match value {
        Some(v) if !v.is_empty() => entry
            .set_password(&v)
            .map_err(|e| format!("Failed to store '{account}': {e}")),
        _ => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("Failed to delete '{account}': {e}")),
        },
    }
}

/// Reads a credential. Absence is `Ok(None)`, not an error — the caller has no
/// use for the difference between "never set" and "cleared".
#[tauri::command]
pub fn get_credential(account: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &account)
        .map_err(|e| format!("Keychain entry error: {e}"))?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to retrieve '{account}': {e}")),
    }
}
