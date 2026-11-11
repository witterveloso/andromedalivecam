import UIKit
import Flutter
import AVFoundation

@main
@objc class AppDelegate: FlutterAppDelegate {
  override func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    GeneratedPluginRegistrant.register(with: self)
    guard let controller = window?.rootViewController as? FlutterViewController else { return super.application(application, didFinishLaunchingWithOptions: launchOptions) }
    UIDevice.current.isBatteryMonitoringEnabled = true
    let channel = FlutterMethodChannel(name: "andromeda/hardware", binaryMessenger: controller.binaryMessenger)
    channel.setMethodCallHandler { call, result in
      switch call.method {
      case "keepAwake": UIApplication.shared.isIdleTimerDisabled = (call.arguments as? Bool) ?? false; result(nil)
      case "status":
        let labels = ["nominal", "fair", "serious", "critical"]
        result(["battery": UIDevice.current.batteryLevel, "thermal": labels[min(ProcessInfo.processInfo.thermalState.rawValue, 3)], "temperatureC": NSNull()])
      case "cameras":
        let devices = AVCaptureDevice.DiscoverySession(deviceTypes: [.builtInWideAngleCamera, .builtInUltraWideCamera, .builtInTelephotoCamera], mediaType: .video, position: .unspecified).devices
        result(devices.filter { !$0.isVirtualDevice }.map { device -> [String: Any] in
          let formats = device.formats.map { format -> [String: Any] in
            let size = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
            return ["width": size.width, "height": size.height, "maxFps": format.videoSupportedFrameRateRanges.map { $0.maxFrameRate }.max() ?? 0]
          }
          return ["id": device.uniqueID, "name": device.localizedName, "physical": true, "front": device.position == .front, "formats": formats, "manualFocus": device.isLockingFocusWithCustomLensPositionSupported, "manualISO": device.isExposureModeSupported(.custom), "manualWB": device.isLockingWhiteBalanceWithCustomDeviceGainsSupported]
        })
      case "control":
        guard let args = call.arguments as? [String: Any], let id = args["id"] as? String, let device = AVCaptureDevice(uniqueID: id), !device.isVirtualDevice else { result(FlutterError(code: "CAMERA", message: "Câmera física não disponível", details: nil)); return }
        do {
          try device.lockForConfiguration(); defer { device.unlockForConfiguration() }
          device.videoZoomFactor = 1.0
          if let focus = args["focus"] as? Double, device.isLockingFocusWithCustomLensPositionSupported { device.setFocusModeLocked(lensPosition: Float(max(0,min(1,focus))), completionHandler: nil) }
          if let iso = args["iso"] as? Double, device.isExposureModeSupported(.custom) { device.setExposureModeCustom(duration: AVCaptureDevice.currentExposureDuration, iso: max(device.activeFormat.minISO,min(device.activeFormat.maxISO,Float(iso))), completionHandler: nil) }
          if let kelvin = args["kelvin"] as? Double, device.isLockingWhiteBalanceWithCustomDeviceGainsSupported {
            var gains = device.deviceWhiteBalanceGains(for: AVCaptureDevice.WhiteBalanceTemperatureAndTintValues(temperature: Float(kelvin), tint: 0))
            gains.redGain=max(1,min(device.maxWhiteBalanceGain,gains.redGain));gains.greenGain=max(1,min(device.maxWhiteBalanceGain,gains.greenGain));gains.blueGain=max(1,min(device.maxWhiteBalanceGain,gains.blueGain))
            device.setWhiteBalanceModeLocked(with: gains, completionHandler: nil)
          }
          if args["auto"] as? Bool == true { if device.isFocusModeSupported(.continuousAutoFocus){device.focusMode = .continuousAutoFocus}; if device.isExposureModeSupported(.continuousAutoExposure){device.exposureMode = .continuousAutoExposure};if device.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance){device.whiteBalanceMode = .continuousAutoWhiteBalance} }
          result(["iso":device.iso,"minISO":device.activeFormat.minISO,"maxISO":device.activeFormat.maxISO,"focus":device.lensPosition])
        } catch { result(FlutterError(code: "CONTROL", message: error.localizedDescription, details: nil)) }
      default: result(FlutterMethodNotImplemented)
      }
    }
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
