@echo off
setlocal
cd /d "%~dp0"

set "MODEL=%~1"
if "%MODEL%"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "app\scripts\setup-local-model.ps1" -Provider ollama
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "app\scripts\setup-local-model.ps1" -Provider ollama -Model "%MODEL%"
)
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if "%EXIT_CODE%"=="0" (
  echo [OK] Local model is ready. In OpenWorkflows choose: Runtime = Claude Code, Channel = Free - Ollama (local).
) else (
  echo [X] Local model setup failed. See messages above.
)
pause
endlocal & exit /b %EXIT_CODE%
