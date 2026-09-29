; FileSynapse — NSIS installer hooks.
;
; Tauri's NSIS template inserts these macros when the file defines them. This
; file exists for one reason: an uninstall that leaves the app's own traces
; behind. Files and shortcuts are removed by the uninstaller. These two are not,
; and one of them is a secret.

!macro NSIS_HOOK_PREUNINSTALL

  ; ── Stored credentials ────────────────────────────────────────────────────
  ;
  ; keyring 3 stores Windows generic credentials under the target name
  ; "{account}.{service}". `service` is KEYCHAIN_SERVICE in
  ; src-tauri/src/credentials.rs, and the four accounts are the fields on
  ; `Credentials`. Both were read out of keyring 3.6.3's own windows.rs rather
  ; than guessed — a wrong name here would delete nothing and fail silently.
  ;
  ; Left behind, these are an Immich API key, a Nextcloud app password and an
  ; agent bearer token, sitting in Credential Manager for a server the app is no
  ; longer installed to talk to.
  DetailPrint "Removing stored credentials..."
  nsExec::ExecToLog 'cmdkey /delete:immichApiKey.filesynapse'
  Pop $0
  nsExec::ExecToLog 'cmdkey /delete:nextcloudUser.filesynapse'
  Pop $0
  nsExec::ExecToLog 'cmdkey /delete:nextcloudAppPassword.filesynapse'
  Pop $0
  nsExec::ExecToLog 'cmdkey /delete:agentToken.filesynapse'
  Pop $0

  ; ── Launch at login ───────────────────────────────────────────────────────
  ;
  ; auto-launch writes the value under HKCU\...\Run using the app's Cargo
  ; package name — `filesynapse`, not the display name — and Windows records
  ; the user's approval of it separately under StartupApproved. Clearing only
  ; the first leaves a phantom row in Task Manager's Startup tab.
  DetailPrint "Removing the login item..."
  DeleteRegValue HKCU "SOFTWARE\Microsoft\Windows\CurrentVersion\Run" "filesynapse"
  DeleteRegValue HKCU "SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "filesynapse"

!macroend
