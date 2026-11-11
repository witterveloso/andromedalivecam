#!/bin/sh
set -eu
cd "$(dirname "$0")"
flutter create --platforms=android,ios --org br.com.andromeda --project-name andromeda_cam .
python3 tool/configure.py
flutter pub get
flutter analyze
flutter build ios --no-codesign
printf '%s\n' 'Abra ios/Runner.xcworkspace no Xcode, selecione sua equipe Apple e assine para instalar no iPhone.'
