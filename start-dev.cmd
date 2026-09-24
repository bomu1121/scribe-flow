@echo off
rem Windows batch decodes this file with the console code page, so keep every line ASCII
rem (UTF-8 Chinese here turns into mojibake and can break parsing). Chinese output comes from
rem scripts/start-dev.mjs, which runs under the 65001 code page set below.
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install Node.js 22 or newer first: https://nodejs.org
  pause
  exit /b 1
)

node "scripts\start-dev.mjs"
if errorlevel 1 pause
