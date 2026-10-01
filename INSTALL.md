# Installing FileSynapse

What to install, on what, in what order. The server comes first — every client
is a viewer and has nothing to show until one exists.

**Nothing in here has been run end to end against a live server.** Each section
says what is verified and what is not, because the difference matters: the
desktop client's screens have been exercised against a mock, and the server-side
steps have been read and dry-run but never executed on a real machine.

---

## 1. The server

One Linux machine. Debian 12 or Ubuntu 22.04; the preflight accepts those two
and refuses anything else by name. It needs Docker, which provisioning installs.

```bash
sudo bash infra/provision/smoke.sh
```

That is the whole install. It installs packages, starts Docker, fetches Immich's
compose from its own release assets, brings up Immich and Nextcloud with their
own databases, joins the tailnet, writes the nightly restic backup, builds the
host agent, and then runs `verify.sh` against the result — so it reports whether
the server *works*, not whether its steps exited zero.

**Run it on a machine you are willing to lose.** It installs packages and starts
services. A throwaway VM is the right shape for a first attempt, and the intended
server is fine too if you have already accepted that.

The tailnet is stubbed by default, because joining a real one adds a machine
called `filesynapse` to your network as a side effect of a test. Set
`SMOKE_REAL_TAILSCALE=1` to join for real.

> **Never run** — `provision.sh`, `verify.sh` and `smoke.sh` have all been
> dry-run against a sandbox with every external command stubbed, which proves
> what they generate. It cannot prove that apt, Docker or systemd do anything
> with it. Treat the first run as the test. `smoke.sh` is written for exactly
> that, and it verifies itself at the end.

### If something is wrong afterwards

```bash
sudo bash infra/provision/verify.sh
```

Read-only, safe on a machine in use, and safe to run again. It reports each
thing separately and exits non-zero if any of them failed. The check worth
knowing about: Nextcloud can be up and answering while refusing every request
that arrives by the tailnet's own name — which looks like a broken install and
is a setting. Nothing else in the project can see that.

---

## 2. Desktop clients

### Windows

```bash
cd app
npm install
npx tauri build
```

Requires the Rust toolchain. Produces, in `app/src-tauri/target/release/bundle/`:

- `nsis/FileSynapse_0.1.0_x64-setup.exe` — 6.2 MB
- `msi/FileSynapse_0.1.0_x64_en-US.msi` — 8.1 MB

Either installs **per-user** — no administrator prompt — with a Start Menu
entry, and embeds the WebView2 bootstrapper so the one prerequisite needs no
internet. Uninstalling removes the four stored credentials from Credential
Manager and the launch-at-login entry.

**It is unsigned**, so SmartScreen warns: *More info* → *Run anyway*.

| | |
|---|---|
| Builds | **Verified** — this is the one that has been built |
| Installed and run by hand | **Not verified** — no install/uninstall cycle has been done end to end |

### Linux

No installer is committed. Build on the machine you intend to run it on:

```bash
cd app && npm install && npx tauri build
```

Produces deb, rpm and AppImage in `app/src-tauri/target/release/bundle/`. Needs
the Tauri system libraries — `webkit2gtk-4.1`, `libayatana-appindicator3`,
`librsvg2`, `patchelf`, `libssl-dev` and `libsecret-1-dev` on Debian and Ubuntu.

**Nothing here has been built or run.** CI has a job for it; the first green run
of that job is the evidence.

Uninstall does not remove the stored credentials — they are in libsecret and
survive deleting the app. Delete the `filesynapse` entries by hand.

### macOS

Same command, on a Mac or a `macos-latest` CI runner — **macOS binaries cannot be
built anywhere else.** Produces `.app` and `.dmg`.

Unsigned, so Gatekeeper refuses it outright: right-click → *Open*, then *Open*
again in the dialog. Once per copy is enough.

Nothing has been built or run, and there is no Mac available to try. Uninstall
leaves the Keychain entries, as on Linux.

---

## 3. Mobile clients

### Android

The app is at `mobile/`. A debug APK is the only phone artefact anything can
produce without a Mac:

```bash
cd mobile
npm install
npx expo prebuild -p android
cd android && ./gradlew assembleDebug
```

The APK lands in `android/app/build/outputs/apk/debug/`. Install with
`adb install <apk>` on a device with USB debugging on.

CI builds this too, and attaches it to the run as `filesynapse-android-debug`.

**Unsigned**, which Android will warn about: *Install anyway*.

| | |
|---|---|
| Bundles | **Verified** — `expo export --platform android` produces 2.6 MB of Hermes bytecode |
| Screens | **Verified** — all four run under test |
| Installed and run on a device | **Not verified.** No device, and no Android SDK on the development machine |

**The one thing that cannot be checked without a device:** the whole backend is
plain `http://` over the tailnet, and Android blocks cleartext by default. It is
configured through `expo-build-properties`, and if that configuration is wrong
**every request fails**. No amount of mock testing shows it.

### iOS

**Not buildable here, and this is a hardware limit rather than a missing step.**
An unsigned iOS build is Simulator-only, and the Simulator needs macOS. A
build that installs on a phone additionally needs an Apple Developer membership.

Use Immich's and Nextcloud's own apps on an iPhone. That is the intended answer
rather than a workaround: camera upload is Immich's job and background upload on
iOS is the hardest problem in this project.

---

## 4. Pointing the clients at the server

Every device — desktop, phone, laptop — needs **Tailscale**, signed into the
same tailnet as the server. Nothing is exposed to the internet and there is no
port forwarding; the tailnet is the whole of the connectivity.

Then, in the app:

1. **First Run** asks for the server's tailnet name (e.g. `filesynapse`) and
   three credentials. One name is enough — the three endpoints are derived from
   it.
2. Press **Test connection**. It probes an Immich route that requires
   `AlbumRead` and a Nextcloud PROPFIND, and reports *which* half failed rather
   than "couldn't connect".
3. **Continue.**

### Where the credentials come from

| Credential | Where |
|---|---|
| Immich API key | Immich → Account Settings → API Keys. Needs the **`all`** permission, or a scope covering the routes the app uses |
| Nextcloud username | The admin account you created on first sign-in |
| Nextcloud app password | Nextcloud → Personal settings → Security → *Create new app password*. **Not** your login password |
| Host agent token | On the server: `sudo cat /opt/filesynapse/agent/.env` |

That last one is generated by provisioning and deliberately not printed, because
the provisioning log is world-readable.

---

## 5. What has not been done

Said once, plainly, because the rest of this document is otherwise confident:

- **Nothing has touched a live Immich or Nextcloud.** Every live API path in the
  client carries an `UNVERIFIED:` marker, and the server-side scripts have been
  dry-run against stubs rather than executed.
- **No server has been provisioned.** `smoke.sh` is written to be the first
  thing to run, and it has not been run.
- **No installer has been through an install/uninstall cycle.**
- **No code is signed**, on any platform.

`../../filesynapsetodo.md` — outside this repository, in `Side Projects/` —
carries the ordered list of what needs a person.
