@echo off
setlocal

set "ROOT=%~dp0"
set "SCRIPT=%ROOT%scripts\intranet-keepalive.js"

if not exist "%SCRIPT%" (
  set "SCRIPT=%ROOT%intranet-keepalive.js"
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js 22 or newer, then run this file again.
  echo https://nodejs.org
  pause
  exit /b 1
)

node "%SCRIPT%" %*
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo Keepalive process exited with code %EXIT_CODE%.
pause
exit /b %EXIT_CODE%
