@echo off
title Calculadora Financiera Personal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Necesitas Node.js 18 o superior: https://nodejs.org
  pause
  exit /b 1
)
start "Calculadora Financiera - servidor" /min node server.js
timeout /t 1 /nobreak >nul
set "URL=http://127.0.0.1:5173"
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%EDGE%" (
  start "" "%EDGE%" --app=%URL% --window-size=1480,940
) else if exist "%CHROME%" (
  start "" "%CHROME%" --app=%URL% --window-size=1480,940
) else (
  start "" %URL%
)
