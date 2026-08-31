@echo off
setlocal
cd /d "%~dp0"

echo Starting ScribeFlow dev servers...
echo   Server: http://localhost:8787
echo   Web:    http://localhost:5173

start "ScribeFlow Server" cmd /k "pnpm --filter @scribe-flow/server dev"
start "ScribeFlow Web" cmd /k "pnpm --filter @scribe-flow/web dev"

endlocal
