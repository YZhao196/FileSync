@echo off
cd /d "%~dp0"
set LOG=%~dp0claude-build.log
echo ==== START %DATE% %TIME% > "%LOG%"
set PATH=%USERPROFILE%\.cargo\bin;%PATH%
echo --- toolchain >> "%LOG%"
where cargo >> "%LOG%" 2>&1
rustc -V >> "%LOG%" 2>&1
cargo -V >> "%LOG%" 2>&1
rustup show >> "%LOG%" 2>&1
where link.exe >> "%LOG%" 2>&1
"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath >> "%LOG%" 2>&1
node -v >> "%LOG%" 2>&1
echo --- tests >> "%LOG%"
call npm test >> "%LOG%" 2>&1
echo TEST_EXIT=%ERRORLEVEL% >> "%LOG%"
echo --- icons >> "%LOG%"
call npx --yes @tauri-apps/cli@2 icon ..\filesyn-icon.png >> "%LOG%" 2>&1
echo ICON_EXIT=%ERRORLEVEL% >> "%LOG%"
echo --- build >> "%LOG%"
call npx --yes @tauri-apps/cli@2 build --debug --no-bundle >> "%LOG%" 2>&1
echo BUILD_EXIT=%ERRORLEVEL% >> "%LOG%"
echo ==== END %DATE% %TIME% >> "%LOG%"
