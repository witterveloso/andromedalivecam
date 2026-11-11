@echo off
cd /d "%~dp0"
call flutter create --platforms=android,ios --org br.com.andromeda --project-name andromeda_cam .
if errorlevel 1 goto :fail
python tool\configure.py
if errorlevel 1 goto :fail
call flutter pub get
if errorlevel 1 goto :fail
call flutter analyze
if errorlevel 1 goto :fail
call flutter build apk --debug
if errorlevel 1 goto :fail
echo APK de teste: build\app\outputs\flutter-apk\app-debug.apk
pause
exit /b 0
:fail
echo Falha. Confira Flutter SDK, Android SDK, Python e a mensagem acima.
pause
exit /b 1
