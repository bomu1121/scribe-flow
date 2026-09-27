@echo off
setlocal
cd /d "%~dp0"

echo ScribeFlow dev servers
echo   Web:    http://localhost:5173
echo   Server: http://localhost:8787
echo.
echo Ctrl+C to stop both.
echo.

pnpm dev
set EXITCODE=%ERRORLEVEL%

echo.
echo Dev servers exited with code %EXITCODE%.
pause

endlocal
