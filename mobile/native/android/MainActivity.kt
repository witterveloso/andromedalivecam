package br.com.andromeda.andromeda_cam

import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CameraCharacteristics
import android.view.WindowManager
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity: FlutterActivity() {
 override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
  super.configureFlutterEngine(flutterEngine)
  MethodChannel(flutterEngine.dartExecutor.binaryMessenger,"andromeda/hardware").setMethodCallHandler { call, result ->
   try { when(call.method) {
    "keepAwake" -> { if(call.arguments == true)window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);result.success(null) }
    "status" -> { val battery=registerReceiver(null,IntentFilter(Intent.ACTION_BATTERY_CHANGED));val level=battery?.getIntExtra(BatteryManager.EXTRA_LEVEL,-1) ?: -1;val scale=battery?.getIntExtra(BatteryManager.EXTRA_SCALE,100) ?: 100;val temp=battery?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE,0);val power=getSystemService(Context.POWER_SERVICE) as PowerManager
     result.success(mapOf("battery" to if(level<0)-1.0 else level.toDouble()/scale,"temperatureC" to if(temp==null||temp==0)null else temp/10.0,"thermal" to if(Build.VERSION.SDK_INT>=29)power.currentThermalStatus.toString() else "indisponível")) }
    "cameras" -> { val manager=getSystemService(Context.CAMERA_SERVICE) as CameraManager;val ids=manager.cameraIdList.toSet();val rows=ids.map { id -> val c=manager.getCameraCharacteristics(id);val physical=if(Build.VERSION.SDK_INT>=28)c.physicalCameraIds else emptySet<String>();val caps=c.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES) ?: intArrayOf();val logical=Build.VERSION.SDK_INT>=28&&caps.contains(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_LOGICAL_MULTI_CAMERA);val front=c.get(CameraCharacteristics.LENS_FACING)==CameraCharacteristics.LENS_FACING_FRONT
      mapOf("id" to id,"name" to "${if(front)"Frontal" else "Traseira"} · câmera $id${if(logical)" (lógica)" else ""}","physical" to !logical,"front" to front,"physicalIds" to physical.toList(),"manualFocus" to false,"manualISO" to false,"manualWB" to false)
     };result.success(rows) }
    "control" -> result.error("UNAVAILABLE","ISO/WB/foco manual Android requer integração do capturador Camera2; não implementado nesta versão",null)
    else -> result.notImplemented()
   }}catch(e:Exception){result.error("HARDWARE",e.message,null)}
  }
 }
}
