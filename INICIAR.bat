@echo off
setlocal
cd /d "%~dp0"
node check.cjs
if errorlevel 1 (
 echo Execute INSTALAR.bat antes de iniciar.
 pause
 exit /b 1
)
set ANDROMEDA_OPEN_BROWSER=1
node server.cjs
pause
