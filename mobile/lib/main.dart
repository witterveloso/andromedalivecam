import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const AndromedaCam());
}

class AndromedaCam extends StatelessWidget {
  const AndromedaCam({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    title: 'Andromeda Cam',
    theme: ThemeData.dark(useMaterial3: true).copyWith(
      scaffoldBackgroundColor: const Color(0xff08080e),
      colorScheme: ColorScheme.fromSeed(
        seedColor: const Color(0xfff5a623),
        brightness: Brightness.dark,
      ),
    ),
    home: const CameraPage(),
  );
}

class CameraPage extends StatefulWidget {
  const CameraPage({super.key});
  @override
  State<CameraPage> createState() => _CameraPageState();
}

class _CameraPageState extends State<CameraPage> with WidgetsBindingObserver {
  static const hardware = MethodChannel('andromeda/hardware');
  final preview = RTCVideoRenderer(), dtvReturn = RTCVideoRenderer();
  final invitation = TextEditingController();
  final Map<String, RTCPeerConnection> peers = {};
  final Map<String, List<RTCIceCandidate>> pending = {};
  final Set<String> remoteReady = {};
  MediaStream? program, intercom;
  WebSocket? socket;
  Timer? timer, retry;
  List<MediaDeviceInfo> devices = [], audioInputs = [];
  List<Map<String, dynamic>> physical = [];
  List<dynamic> ice = [];
  String? selectedCamera, selectedAudio;
  String status = 'Cole o convite da mesa para conectar.',
      tally = 'offline',
      cameraName = 'ANDROMEDA CAM';
  bool running = false,
      starting = false,
      muted = false,
      talking = false,
      renderReady = false,
      closed = false;
  int width = 1280,
      height = 720,
      fps = 30,
      epoch = 0,
      lastTally = 0,
      started = 0,
      lastBytes = 0,
      lastStats = 0;
  double bitrate = 3,
      measuredBitrate = 0,
      audioLevel = 0,
      focus = .5,
      iso = 100,
      kelvin = 5600;
  Map<String, dynamic> telemetry = {};
  Future<void> chain = Future.value();
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    initialize();
  }

  void refresh() {
    if (mounted && !closed) setState(() {});
  }

  Future<void> initialize() async {
    await preview.initialize();
    await dtvReturn.initialize();
    renderReady = true;
    timer = Timer.periodic(const Duration(seconds: 1), (_) => tick());
    refresh();
  }

  void say(Object s) {
    status = s.toString();
    refresh();
  }

  void send(Map<String, dynamic> m) {
    if (socket?.readyState == WebSocket.open) socket!.add(jsonEncode(m));
  }

  Future<void> discover() async {
    devices = await Helper.cameras;
    audioInputs = await Helper.enumerateDevices('audioinput');
    try {
      final rows = await hardware.invokeListMethod<dynamic>('cameras') ?? [];
      physical = rows
          .map((e) => Map<String, dynamic>.from(e as Map))
          .where(
            (e) =>
                e['physical'] == true &&
                devices.any((d) => d.deviceId == e['id']),
          )
          .toList();
    } catch (e) {
      physical = [];
      say('Inventário físico indisponível: $e');
    }
    if (selectedCamera == null && physical.isNotEmpty) {
      selectedCamera =
          (physical.where((e) => e['front'] != true).firstOrNull ??
                  physical.first)['id']
              as String;
    }
  }

  Future<void> connect() async {
    if (starting || running) return;
    Uri? u;
    try {
      u = Uri.parse(invitation.text.trim());
      if (u.scheme != 'https' ||
          u.host.isEmpty ||
          !RegExp(r'^[a-f0-9]{48}$').hasMatch(u.fragment))
        throw Exception('Use o convite HTTPS gerado pela mesa.');
    } catch (e) {
      say(e);
      return;
    }
    starting = true;
    refresh();
    try {
      // The first permission request also makes camera IDs available on Android/iOS.
      final permissionStream = await navigator.mediaDevices.getUserMedia({
        'audio': true,
        'video': true,
      });
      for (final t in permissionStream.getTracks()) {
        await t.stop();
      }
      await permissionStream.dispose();
      await discover();
      if (physical.isEmpty || selectedCamera == null)
        throw Exception(
          'Nenhuma câmera física acessível ao capturador. Este aparelho precisa de adaptação Camera2; não será apresentado zoom digital como óptico.',
        );
      if (selectedAudio != null) await Helper.selectAudioInput(selectedAudio!);
      program = await navigator.mediaDevices.getUserMedia({
        'audio': {
          'echoCancellation': true,
          'noiseSuppression': true,
          'autoGainControl': false,
        },
        'video': {
          'deviceId': selectedCamera,
          'width': width,
          'height': height,
          'frameRate': fps,
        },
      });
      intercom = await navigator.mediaDevices.getUserMedia({
        'audio': {'echoCancellation': true, 'noiseSuppression': true},
        'video': false,
      });
      for (final t in intercom!.getAudioTracks()) {
        t.enabled = false;
      }
      await Helper.setZoom(program!.getVideoTracks().first, 1.0);
      await Helper.setSpeakerphoneOn(false);
      preview.srcObject = program;
      running = true;
      started = DateTime.now().millisecondsSinceEpoch;
      lastTally = 0;
      await hardware.invokeMethod('keepAwake', true);
      await signal(u!);
    } catch (e) {
      await stop();
      say('Não foi possível iniciar: $e');
    } finally {
      starting = false;
      refresh();
    }
  }

  Future<void> clearPeers() async {
    setTalk(false);
    final old = peers.values.toList();
    peers.clear();
    pending.clear();
    remoteReady.clear();
    for (final pc in old) {
      await pc.close();
      await pc.dispose();
    }
    dtvReturn.srcObject = null;
  }

  Future<void> signal(Uri u) async {
    if (!running) return;
    final generation = ++epoch;
    await clearPeers();
    try {
      final ws = await WebSocket.connect(
        u
            .replace(
              scheme: 'wss',
              path: '/signal',
              query: null,
              fragment: null,
            )
            .toString(),
      );
      if (generation != epoch || !running) {
        await ws.close();
        return;
      }
      socket = ws;
      send({'type': 'join', 'key': u.fragment});
      ws.listen(
        (raw) {
          if (generation != epoch) return;
          chain = chain
              .then(
                (_) => message(
                  Map<String, dynamic>.from(jsonDecode(raw as String) as Map),
                ),
              )
              .catchError((Object e) {
                say('Conexão: $e');
              });
        },
        onError: (Object e) {
          say('Sinalização: $e');
        },
        onDone: () {
          if (generation != epoch || !running) return;
          tally = 'offline';
          setTalk(false);
          if ([4001, 4002, 4003].contains(ws.closeCode)) {
            stop();
            say(
              'Convite inválido, ocupado, revogado ou expirado. Gere outro na mesa.',
            );
            return;
          }
          say('Reconectando…');
          retry?.cancel();
          retry = Timer(const Duration(seconds: 3), () => signal(u));
        },
      );
    } catch (e) {
      say('Sem conexão com o gateway: $e');
      if (running) {
        retry?.cancel();
        retry = Timer(const Duration(seconds: 3), () => signal(u));
      }
    }
  }

  Future<void> makePeer(String lane) async {
    final pc = await createPeerConnection({
      'iceServers': ice,
      'sdpSemantics': 'unified-plan',
    });
    peers[lane] = pc;
    pending[lane] = [];
    final stream = lane == 'media' ? program! : intercom!;
    for (final t in stream.getTracks()) {
      await pc.addTrack(t, stream);
    }
    pc.onIceCandidate = (candidate) {
      if (candidate.candidate != null)
        send({
          'type': 'signal',
          'lane': lane,
          'signal': {'candidate': candidate.toMap()},
        });
    };
    if (lane == 'intercom')
      pc.onTrack = (event) {
        if (event.streams.isNotEmpty) dtvReturn.srcObject = event.streams.first;
      };
    pc.onConnectionState = (state) {
      if (lane != 'media') return;
      if (state == RTCPeerConnectionState.RTCPeerConnectionStateConnected) {
        say('Vídeo conectado. Tally indica o PGM da mesa.');
      } else if (state == RTCPeerConnectionState.RTCPeerConnectionStateFailed ||
          state == RTCPeerConnectionState.RTCPeerConnectionStateDisconnected) {
        tally = 'offline';
        setTalk(false);
        say('Vídeo interrompido. Reconectando…');
        retry?.cancel();
        retry = Timer(const Duration(seconds: 3), () {
          if (running) socket?.close();
        });
      }
    };
    final offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send({
      'type': 'signal',
      'lane': lane,
      'signal': {'description': offer.toMap()},
    });
  }

  Future<void> message(Map<String, dynamic> m) async {
    switch (m['type']) {
      case 'ready':
        cameraName = m['name'] as String;
        ice = m['iceServers'] as List;
        refresh();
        break;
      case 'negotiate':
        await clearPeers();
        ice = m['iceServers'] as List;
        await makePeer('media');
        await makePeer('intercom');
        break;
      case 'desk-offline':
        await clearPeers();
        tally = 'offline';
        say('Mesa desconectada. Aguardando o DTV.');
        break;
      case 'tally':
        lastTally = DateTime.now().millisecondsSinceEpoch;
        tally = m['state'] as String;
        refresh();
        break;
      case 'signal':
        final lane = m['lane'] as String, pc = peers[lane];
        if (pc == null) return;
        final s = m['signal'] as Map;
        if (s['description'] != null) {
          final d = s['description'] as Map;
          await pc.setRemoteDescription(
            RTCSessionDescription(d['sdp'] as String, d['type'] as String),
          );
          remoteReady.add(lane);
          for (final c in pending[lane] ?? []) {
            await pc.addCandidate(c);
          }
          pending[lane] = [];
          if (lane == 'media') await applyBitrate();
        } else if (s['candidate'] != null) {
          final c = s['candidate'] as Map,
              iceCandidate = RTCIceCandidate(
                c['candidate'] as String,
                c['sdpMid'] as String?,
                c['sdpMLineIndex'] as int?,
              );
          if (remoteReady.contains(lane)) {
            await pc.addCandidate(iceCandidate);
          } else {
            pending[lane]?.add(iceCandidate);
          }
        }
        break;
    }
  }

  Future<void> applyBitrate() async {
    final pc = peers['media'];
    if (pc == null) return;
    for (final sender in await pc.getSenders()) {
      if (sender.track?.kind != 'video') continue;
      final parameters = sender.parameters;
      for (final e in parameters.encodings ?? <RTCRtpEncoding>[]) {
        e.maxBitrate = (bitrate * 1000000).round();
      }
      await sender.setParameters(parameters);
    }
  }

  void setTalk(bool on) {
    talking = on && running;
    for (final t in program?.getAudioTracks() ?? <MediaStreamTrack>[]) {
      t.enabled = !muted && !talking;
    }
    for (final t in intercom?.getAudioTracks() ?? <MediaStreamTrack>[]) {
      t.enabled = talking;
    }
    send({'type': 'talk', 'active': talking});
    refresh();
  }

  bool changingLens = false;
  Future<void> switchLens(String id) async {
    if(changingLens || !physical.any((e)=>e['id']==id)) return;
    changingLens=true;
    try {
      if(program!=null){
        final old=program!.getVideoTracks().first;
        final senders=await peers['media']?.getSenders()??<RTCRtpSender>[];
        final videoSenders=senders.where((s)=>s.track?.kind=='video').toList();
        await old.stop(); await program!.removeTrack(old);
        final replacement=await navigator.mediaDevices.getUserMedia({'audio':false,'video':{'deviceId':id,'width':width,'height':height,'frameRate':fps}});
        final track=replacement.getVideoTracks().first;
        await program!.addTrack(track);for(final sender in videoSenders){await sender.replaceTrack(track);}
        await replacement.removeTrack(track);await replacement.dispose();
        await Helper.setZoom(track,1.0);preview.srcObject=program;
      }
      selectedCamera=id;HapticFeedback.selectionClick();refresh();
    }catch(e){say('Lente não disponível: $e. Reconecte se a captura parar.');}
    finally{changingLens=false;}
  }
  Future<void> control(Map<String, dynamic> values) async {
    if (program == null || selectedCamera == null) return;
    try {
      await hardware.invokeMethod('control', {'id': selectedCamera, ...values});
      say('Controle aplicado.');
    } catch (e) {
      say('Controle não disponível: $e');
    }
  }

  Future<void> tick() async {
    if (closed) return;
    try {
      telemetry = Map<String, dynamic>.from(
        await hardware.invokeMethod('status') as Map,
      );
    } catch (_) {}
    final now = DateTime.now().millisecondsSinceEpoch;
    if (now - lastTally > 3500) tally = 'offline';
    try {
      final stats = await peers['media']?.getStats();
      int bytes = 0;
      for (final report in stats ?? <StatsReport>[]) {
        final v = report.values;
        if (report.type == 'outbound-rtp' &&
            (v['kind'] == 'video' || v['mediaType'] == 'video'))
          bytes += (v['bytesSent'] as num? ?? 0).toInt();
        if (report.type == 'media-source' && v['kind'] == 'audio')
          audioLevel = (v['audioLevel'] as num? ?? 0).toDouble();
      }
      if (lastStats > 0)
        measuredBitrate =
            max(0, bytes - lastBytes) * 8 / (now - lastStats) / 1000;
      lastBytes = bytes;
      lastStats = now;
    } catch (_) {}
    refresh();
  }

  Future<void> stop() async {
    running = false;
    epoch++;
    retry?.cancel();
    socket?.close();
    socket = null;
    await clearPeers();
    for (final s in [program, intercom]) {
      if (s != null) {
        for (final t in s.getTracks()) {
          await t.stop();
        }
        await s.dispose();
      }
    }
    program = null;
    intercom = null;
    if (!closed) preview.srcObject = null;
    tally = 'offline';
    audioLevel = 0;
    measuredBitrate = 0;
    lastBytes = 0;
    lastStats = 0;
    try {
      await hardware.invokeMethod('keepAwake', false);
    } catch (_) {}
    refresh();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) {
      setTalk(false);
      tally = 'offline';
      if (state == AppLifecycleState.paused) {
        stop();
        say('Captura encerrada ao sair do app. Volte e conecte novamente.');
      }
    }
  }

  @override
  void dispose() {
    closed = true;
    WidgetsBinding.instance.removeObserver(this);
    timer?.cancel();
    retry?.cancel();
    stop();
    preview.dispose();
    dtvReturn.dispose();
    invitation.dispose();
    super.dispose();
  }

  void setup() {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, update) => SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(
              20,
              20,
              20,
              MediaQuery.of(ctx).viewInsets.bottom + 20,
            ),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text(
                    'Configurações de contribuição',
                    style: TextStyle(fontSize: 20),
                  ),
                  TextField(
                    controller: invitation,
                    obscureText: true,
                    autocorrect: false,
                    decoration: const InputDecoration(
                      labelText: 'Cole o convite HTTPS da mesa',
                    ),
                  ),
                  DropdownButton<int>(
                    value: height,
                    items: [720, 1080, 2160]
                        .map(
                          (h) => DropdownMenuItem(
                            value: h,
                            child: Text(
                              h == 2160 ? '4K · depende do aparelho' : '${h}p',
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: running
                        ? null
                        : (v) => update(() {
                            height = v!;
                            width = height == 720
                                ? 1280
                                : height == 1080
                                ? 1920
                                : 3840;
                          }),
                  ),
                  DropdownButton<int>(
                    value: fps,
                    items: [24, 30, 60]
                        .map(
                          (f) =>
                              DropdownMenuItem(value: f, child: Text('$f fps')),
                        )
                        .toList(),
                    onChanged: running ? null : (v) => update(() => fps = v!),
                  ),
                  Text('Bitrate alvo: ${bitrate.toStringAsFixed(1)} Mbps'),
                  Slider(
                    value: bitrate,
                    min: 1,
                    max: 12,
                    divisions: 22,
                    onChanged: (v) {
                      update(() => bitrate = v);
                      applyBitrate().catchError((Object e) => say(e));
                    },
                  ),
                  DropdownButton<String>(
                    value: selectedAudio,
                    hint: const Text('Microfone padrão / entrada externa'),
                    isExpanded: true,
                    items: audioInputs
                        .map(
                          (d) => DropdownMenuItem(
                            value: d.deviceId,
                            child: Text(d.label),
                          ),
                        )
                        .toList(),
                    onChanged: running
                        ? null
                        : (v) => update(() => selectedAudio = v),
                  ),
                  const Text(
                    'Conecte fones antes de iniciar. Programa e intercom usam a mesma entrada física, mas canais separados. Ao segurar PTT, o áudio do programa fica mudo. Resolução, fps e entrada de áudio são aplicados ao reconectar.',
                  ),
                  if (Platform.isIOS) ...[
                    Text('Foco manual: ${focus.toStringAsFixed(2)}'),
                    Slider(
                      value: focus,
                      onChanged: (v) => update(() => focus = v),
                      onChangeEnd: (v) => control({'focus': v}),
                    ),
                    Text('ISO solicitado: ${iso.round()}'),
                    Slider(
                      value: iso,
                      min: 25,
                      max: 3200,
                      onChanged: (v) => update(() => iso = v),
                      onChangeEnd: (v) => control({'iso': v}),
                    ),
                    Text('Balanço de branco: ${kelvin.round()} K'),
                    Slider(
                      value: kelvin,
                      min: 2500,
                      max: 8500,
                      onChanged: (v) => update(() => kelvin = v),
                      onChangeEnd: (v) => control({'kelvin': v}),
                    ),
                    TextButton(
                      onPressed: () => control({'auto': true}),
                      child: const Text(
                        'Restaurar foco / exposição / WB automáticos',
                      ),
                    ),
                  ] else
                    const Text(
                      'Android: toque na imagem para foco/exposição automáticos. ISO, WB e foco manual ainda não integrados ao capturador Camera2.',
                    ),
                  const Text(
                    'OIS/EIS: gerenciados pelo capturador/sistema; seleção manual ainda indisponível. Sem zoom digital. Lentes não expostas pelo fabricante não aparecem.',
                  ),
                  FilledButton(
                    onPressed: () => Navigator.pop(ctx),
                    child: const Text('Voltar à câmera'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final color = tally == 'program'
        ? const Color(0xffe63946)
        : tally == 'preview'
        ? const Color(0xff1d985a)
        : const Color(0xff353544);
    final label = {
      'program': 'NO AR · PGM',
      'preview': 'PREVIEW',
      'standby': 'EM ESPERA',
      'offline': 'SEM RETORNO DA MESA',
    }[tally]!;
    final battery = (telemetry['battery'] as num?)?.toDouble() ?? -1;
    final sec = running
        ? (DateTime.now().millisecondsSinceEpoch - started) ~/ 1000
        : 0;
    return Scaffold(
      body: Stack(
        children: [
          if (renderReady)
            Positioned.fill(
              child: LayoutBuilder(
                builder: (ctx, b) => GestureDetector(
                  onTapDown: (d) {
                    if (program == null) return;
                    final point = Point<double>(
                      d.localPosition.dx / b.maxWidth,
                      d.localPosition.dy / b.maxHeight,
                    );
                    Helper.setFocusPoint(
                      program!.getVideoTracks().first,
                      point,
                    ).catchError((Object e) => say(e));
                    Helper.setExposurePoint(
                      program!.getVideoTracks().first,
                      point,
                    ).catchError((Object e) => say(e));
                  },
                  child: RTCVideoView(
                    preview,
                    objectFit:
                        RTCVideoViewObjectFit.RTCVideoViewObjectFitContain,
                  ),
                ),
              ),
            ),
          if (renderReady)
            Positioned(width: 1, height: 1, child: RTCVideoView(dtvReturn)),
          Positioned.fill(
            child: IgnorePointer(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  border: Border.all(
                    color: color,
                    width: tally == 'program' ? 6 : 1,
                  ),
                ),
              ),
            ),
          ),
          SafeArea(
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.all(14),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'ANDROMEDA CAM',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          letterSpacing: 2,
                        ),
                      ),
                      IconButton(
                        onPressed: setup,
                        icon: const Icon(Icons.settings),
                      ),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 22,
                    vertical: 9,
                  ),
                  decoration: BoxDecoration(
                    color: color,
                    borderRadius: BorderRadius.circular(24),
                  ),
                  child: Text(
                    label,
                    style: const TextStyle(
                      fontWeight: FontWeight.w900,
                      letterSpacing: 2,
                    ),
                  ),
                ),
                Text(cameraName),
                Padding(
                  padding: const EdgeInsets.all(8),
                  child: Text(
                    status,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 11,
                      backgroundColor: Colors.black54,
                    ),
                  ),
                ),
                Text(
                  '${measuredBitrate.toStringAsFixed(2)} Mbps · ${preview.videoWidth} × ${preview.videoHeight} · bateria ${battery < 0 ? '—' : '${(battery * 100).round()}%'}',
                  style: const TextStyle(fontSize: 11),
                ),
                Text(
                  'Térmico: ${telemetry['thermal'] ?? '—'} · Bateria °C: ${telemetry['temperatureC'] ?? 'não exposta'}',
                  style: const TextStyle(fontSize: 10),
                ),
                const Spacer(),
                Container(
                  color: Colors.black87,
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    children: [
                      Text(
                        '${(sec ~/ 60).toString().padLeft(2, '0')}:${(sec % 60).toString().padLeft(2, '0')} · entrada de áudio',
                      ),
                      LinearProgressIndicator(
                        value: audioLevel.clamp(0, 1),
                        color: Colors.green,
                      ),
                      SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        child: Row(
                          children: physical
                              .map(
                                (d) => Padding(
                                  padding: const EdgeInsets.all(4),
                                  child: ChoiceChip(
                                    label: Text(
                                      d['name'] as String,
                                      style: const TextStyle(fontSize: 10),
                                    ),
                                    selected: selectedCamera == d['id'],
                                    onSelected: (_) =>
                                        switchLens(d['id'] as String),
                                  ),
                                ),
                              )
                              .toList(),
                        ),
                      ),
                      if (physical.length > 1)
                        Slider(
                          value: max(
                            0,
                            physical.indexWhere(
                              (d) => d['id'] == selectedCamera,
                            ),
                          ).toDouble(),
                          min: 0,
                          max: (physical.length - 1).toDouble(),
                          divisions: physical.length - 1,
                          onChanged: (v) =>
                              switchLens(physical[v.round()]['id'] as String),
                        ),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                        children: [
                          IconButton(
                            onPressed: () {
                              muted = !muted;
                              setTalk(false);
                            },
                            icon: Icon(muted ? Icons.mic_off : Icons.mic),
                          ),
                          FilledButton(
                            style: FilledButton.styleFrom(
                              backgroundColor: const Color(0xffe63946),
                              padding: const EdgeInsets.all(22),
                            ),
                            onPressed: starting
                                ? null
                                : () => running ? stop() : connect(),
                            child: Text(
                              starting
                                  ? 'AGUARDE'
                                  : running
                                  ? 'PARAR'
                                  : 'CONECTAR',
                            ),
                          ),
                          Listener(
                            onPointerDown: (_) => setTalk(true),
                            onPointerUp: (_) => setTalk(false),
                            onPointerCancel: (_) => setTalk(false),
                            child: Container(
                              padding: const EdgeInsets.all(16),
                              decoration: BoxDecoration(
                                color: talking
                                    ? Colors.deepPurple
                                    : Colors.white12,
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: const Text(
                                'SEGURE\nFALAR DTV',
                                textAlign: TextAlign.center,
                                style: TextStyle(fontSize: 10),
                              ),
                            ),
                          ),
                        ],
                      ),
                      const Text(
                        'Use fones · PTT silencia o áudio do programa',
                        style: TextStyle(fontSize: 10),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

extension FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
