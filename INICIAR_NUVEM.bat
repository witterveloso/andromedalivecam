@echo off
cd /d "%~dp0"
if not exist mesa-cloud.env (
 echo Falta mesa-cloud.env fornecido pelo administrador do gateway.
 pause
 exit /b 1
)
node --env-file=mesa-cloud.env server.cjs
pause
