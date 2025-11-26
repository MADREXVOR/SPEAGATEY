@echo off
echo ============================================
echo         Ghost Dispatcher - One Click
echo ============================================
echo.

REM Change to this script's directory (project root)
cd /d "%~dp0"

REM Create virtual environment if it doesn't exist
if not exist .venv (
    echo [*] Creating virtual environment...
    python -m venv .venv
)

REM Activate venv
call .venv\Scripts\activate.bat

REM Install / update dependencies
echo [*] Installing / updating dependencies...
pip install -r requirements.txt

echo.
echo [*] Starting Ghost Dispatcher server on http://localhost:5000
echo     A browser window will open automatically.
echo.

REM Start the Flask server in a new console window
start "Ghost Dispatcher Server" cmd /k "cd /d %CD% && python -m core.app"

REM Give the server a few seconds to boot, then open the site
timeout /t 3 >nul
start "" http://localhost:5000/

echo.
echo [*] Done. If the browser didn't open, manually visit: http://localhost:5000/
echo     You can close this window now.
