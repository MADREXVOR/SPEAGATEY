@echo off
setlocal

REM ===========================================
REM  Ghost Dispatcher - Sync private -> public
REM ===========================================

REM >>> MUST MATCH ApplyPatchAndSync.bat <<<
set "PRIVATE_DIR=C:\ghost_dispatcher\ghost_dispatcher"
set "PUBLIC_GIT_DIR=C:\Users\Mad Vapegod 420\SPEAGATEY"
REM =========================================

echo.
echo === Ghost Dispatcher: Sync private project into public Git mirror ===
echo Source (private): %PRIVATE_DIR%
echo Dest   (public) : %PUBLIC_GIT_DIR%
echo.

REM Check dirs exist
if not exist "%PRIVATE_DIR%" (
    echo !!
    echo !! PRIVATE_DIR does not exist: %PRIVATE_DIR%
    echo !!
    exit /b 1
)

if not exist "%PUBLIC_GIT_DIR%" (
    echo !!
    echo !! PUBLIC_GIT_DIR does not exist: %PUBLIC_GIT_DIR%
    echo !!
    exit /b 1
)

REM ---------------------------------------------------
REM Robocopy:
REM   - /MIR    : mirror directory tree
REM   - /XD     : exclude dirs (.git, .venv, etc.)
REM   - /XF     : exclude secret/config files
REM   - /R /W   : retry 3 times, 5 sec wait
REM   Robocopy exit codes < 8 are "success-ish".
REM ---------------------------------------------------
robocopy "%PRIVATE_DIR%" "%PUBLIC_GIT_DIR%" *.* /S /E /MIR ^
  /XD .git .venv __pycache__ .idea .vscode patches ^
  /XF .env secrets.json config_private.py api_keys.json ^
  /R:3 /W:5

set "RC=%ERRORLEVEL%"
if %RC% LSS 8 (
    echo Sync completed (robocopy exit code %RC%).
    endlocal
    exit /b 0
) else (
    echo !!
    echo !! Robocopy reported a failure (exit code %RC%).
    echo !!
    endlocal
    exit /b %RC%
)
