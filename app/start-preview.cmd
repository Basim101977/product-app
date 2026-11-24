@echo off
rem Hathir local preview: synthetic data only, no Firebase. Double-click to start.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org then run this file again.
  pause
  exit /b 1
)
echo Starting the Hathir preview. Keep this window open while you use it.
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:4199/?ui=simple"
node preview.cjs
pause
