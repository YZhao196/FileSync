The desktop client, the Android client, and — in the Linux builds — the
one-click server install.

## Which file you want

| File | What it is |
|---|---|
| `FileSynapse_*_x64-setup.exe` | Windows client. Installs per-user, no administrator prompt |
| `FileSynapse_*_x64_en-US.msi` | The same, for anyone deploying with Group Policy or `msiexec` |
| `FileSynapse_*_amd64.AppImage` | Linux client **and server**. Runs on the machine it will host from |
| `FileSynapse_*_amd64.deb` | The same, for Debian and Ubuntu |
| `FileSynapse_*.rpm` | The same, for Fedora and friends |
| `FileSynapse_*_aarch64.dmg` | macOS client. Apple silicon — Intel Macs are not built |
| `filesynapse-*-android.apk` | Android client. Installs over `adb` or by sideloading |

**Windows and macOS builds are clients only.** Immich and Nextcloud are Linux
containers, so the server has to be a Linux machine. The Linux build carries the
**Set up this computer as your server** button; the other two do not, and say so
rather than failing obscurely.

## Nothing here is signed

Every bundle is unsigned. Windows: SmartScreen warns — *More info* → *Run
anyway*. macOS: Gatekeeper refuses outright — right-click → *Open*, then *Open*
again. Android: *Install anyway*. Linux blocks nothing.

## What is not yet verified

This is a preview build and the honest summary is that the client has never
reached a real server:

- **The desktop client** builds, passes 151 tests and a strict typecheck, and its
  screens have been walked in a browser against a development mock. It has never
  contacted a live Immich or Nextcloud.
- **The server install** (the Linux builds' button) has been dry-run against a
  sandbox with every external command stubbed. It has never run on a machine.
- **The Android build** bundles and all four screens run under test. It has never
  been installed on a device, and the cleartext-HTTP configuration it depends on
  is exactly the thing a device would prove.
- **The macOS and Linux desktop bundles** are produced by this workflow. If you
  are reading a release, they were built here and by nothing else.

Expect to be the first person to run this. `PLAN.md` in the repository has every
decision and its reason.
