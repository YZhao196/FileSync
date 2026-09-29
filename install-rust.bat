@echo off
echo ============================================================
echo  FileSynapse - Rust Toolchain Setup
echo ============================================================
echo.
echo Step 1: Installing Rust toolchain...
winget install --id Rustlang.Rustup -e --accept-package-agreements --accept-source-agreements
echo.
echo Step 2: Installing MSVC C++ Build Tools...
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --accept-package-agreements --accept-source-agreements --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
echo.
echo ============================================================
echo  Done! Close this window, then run:
echo    cd app
echo    npx tauri dev
echo ============================================================
pause
