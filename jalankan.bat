@echo off
title SSL Monitoring
cd /d "%~dp0"
start "" cmd /c "timeout /t 8 >nul & start http://127.0.0.1:3000"
call npm start
pause
