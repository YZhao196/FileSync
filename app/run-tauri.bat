@echo off
echo ============================================================
echo  FileSynapse - Generate icons and launch Tauri dev mode
echo ============================================================
echo.
cd /d "%~dp0"

echo Step 1: Generating app icons from filesyn-icon.png...
npx tauri icon ..\filesyn-icon.png
if errorlevel 1 (
    echo ERROR: Icon generation failed. Check that filesyn-icon.png exists in the FileSync root.
    pause
    exit /b 1
)
echo Icons generated successfully!
echo.

echo Step 2: Launching Tauri dev mode...
echo (This will open the FileSynapse desktop app)
echo.
npx tauri dev

pause
