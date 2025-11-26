@echo off
setlocal

REM =====================================================
REM  Wrapper script so you can run this from the REAL
REM  ghost_dispatcher folder and still use the mirror.
REM =====================================================

REM Where the public Git mirror lives:
set "PUBLIC_GIT_DIR=C:\Users\Mad Vapegod 420\SPEAGATEY"

echo.
echo [Wrapper] Jumping to %PUBLIC_GIT_DIR% and running ApplyPatchAndSync.bat ...
echo.

cd /d "%PUBLIC_GIT_DIR%"
if errorlevel 1 (
    echo !!
    echo !! Could not cd into %PUBLIC_GIT_DIR%
    echo !!
    endlocal
    exit /b 1
)

call ApplyPatchAndSync.bat

echo.
echo [Wrapper] Done. You can tell ChatGPT: "Check the SPEAGATEY repo."
echo.

endlocal
exit /b 0
