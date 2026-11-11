from pathlib import Path
import shutil, plistlib
root=Path(__file__).resolve().parents[1]
android=root/'android/app/src/main/AndroidManifest.xml'
s=android.read_text()
permissions='''<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.CAMERA"/>
<uses-permission android:name="android.permission.RECORD_AUDIO"/>
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS"/>
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/>
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT"/>
<uses-feature android:name="android.hardware.camera.any" android:required="true"/>
'''
if 'android.permission.RECORD_AUDIO' not in s:s=s.replace('<application',permissions+'<application',1)
s=s.replace('android:label="andromeda_cam"','android:label="Andromeda Cam"');android.write_text(s)
dest=root/'android/app/src/main/kotlin/br/com/andromeda/andromeda_cam/MainActivity.kt';dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy(root/'native/android/MainActivity.kt',dest)
shutil.copy(root/'native/ios/AppDelegate.swift',root/'ios/Runner/AppDelegate.swift')
f=root/'ios/Runner/Info.plist'
with f.open('rb') as stream:d=plistlib.load(stream)
d.update(CFBundleDisplayName='Andromeda Cam',NSCameraUsageDescription='Transmitir a câmera para a mesa Andromeda Live.',NSMicrophoneUsageDescription='Captar áudio do programa e conversar com o DTV.',NSLocalNetworkUsageDescription='Conectar à mesa na rede local ou privada Tailscale.')
with f.open('wb') as stream:plistlib.dump(d,stream)
# Keep capture in foreground; no unsupported background-camera entitlement.
print('Permissões e canais nativos configurados. Revise iOS deployment target e Android minSdk conforme flutter_webrtc.')

# Remove only Flutter's generated counter test: this project has another root widget.
test=root/'test/widget_test.dart'
if test.exists() and 'MyApp' in test.read_text(): test.unlink()
