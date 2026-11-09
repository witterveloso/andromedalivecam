@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
 echo Instale o Node.js LTS em https://nodejs.org/ e abra este arquivo novamente.
 pause
 exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 (
 echo Atualize o Node.js para a versao 22 ou superior.
 pause
 exit /b 1
)
echo Instalando dependencias e codificador FFmpeg...
call npm ci --omit=dev --no-audit --no-fund
if errorlevel 1 (
 echo A instalacao falhou. Confira a conexao com a internet.
 pause
 exit /b 1
)
node check.cjs
if errorlevel 1 (
 echo Consulte LEIA_PRIMEIRO.html para configurar o FFmpeg manualmente.
 pause
 exit /b 1
)
echo Instalacao concluida. Abra INICIAR.bat.
pause
