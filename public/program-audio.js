'use strict';
// Operator-only UI: never drawn into the PROGRAM capture canvas.
const pgmAudio=document.createElement('section');pgmAudio.className='pgm-audio-monitor';pgmAudio.setAttribute('aria-label','Monitoramento do áudio PROGRAM');pgmAudio.innerHTML='<div class="pgm-audio-heading"><strong>ÁUDIO · PROGRAM</strong><span id="pgmAudioState" role="status">ATIVAR ÁUDIO</span></div><div class="pgm-audio-channels"><div><b>L</b><meter id="pgmLeft" min="0" max="1" aria-label="Pico esquerdo do PROGRAM"></meter></div><div><b>R</b><meter id="pgmRight" min="0" max="1" aria-label="Pico direito do PROGRAM"></meter></div></div><div class="pgm-audio-actions"><button id="pgmAudioEnable">Ativar medidores</button><button id="pgmListen" aria-pressed="false">Ouvir em fones</button><span id="pgmAudioTransport">ENVIO PARADO</span></div><small>Master enviado ao codificador · confirme a recepção no destino.</small>';
const programMonitor=$('#monProgram'),programCard=document.createElement('div');programCard.className='program-card';programMonitor.before(programCard);programCard.append(programMonitor,pgmAudio);installVu($('#pgmLeft'));installVu($('#pgmRight'));
let pgmStereo=null,pgmSilenceSince=null;
function enableProgramMeters(){if(pgmStereo||!audioMixer.context)return;const ac=audioMixer.context,splitter=ac.createChannelSplitter(2),left=ac.createAnalyser(),right=ac.createAnalyser(),sink=ac.createGain();left.fftSize=1024;right.fftSize=1024;sink.gain.value=0;audioMixer.master.connect(splitter);splitter.connect(left,0);splitter.connect(right,1);left.connect(sink);right.connect(sink);sink.connect(ac.destination);pgmStereo={left,right,splitter,sink};}
$('#pgmAudioEnable').onclick=async()=>{try{await audioMixer.enable();enableProgramMeters();updateProgramAudio()}catch(e){$('#pgmAudioState').textContent='ÁUDIO INDISPONÍVEL';log(e.message)}};
$('#pgmListen').onclick=async()=>{try{await audioMixer.enable();enableProgramMeters();const on=!$('#listenMixer').checked;$('#listenMixer').checked=on;audioMixer.monitor.gain.value=on?1:0;updateProgramAudio()}catch(e){log('Monitoração indisponível: '+e.message)}};
function programPeak(analyser){if(!analyser)return 0;const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);let peak=0;for(const n of data)peak=Math.max(peak,Math.abs(n));return peak;}
function updateProgramAudio(now=performance.now()){
 enableProgramMeters();const running=audioMixer.context?.state==='running',left=running?pgmStereo?.left:null,right=running?pgmStereo?.right:null;
 paintVu($('#pgmLeft'),left);paintVu($('#pgmRight'),right);const peak=Math.max(programPeak(left),programPeak(right));
 if(!running||peak>0.001)pgmSilenceSince=null;else if(pgmSilenceSince===null)pgmSilenceSince=now;
 const status=!running?'ATIVAR ÁUDIO':peak>=1?'PICO · LIMITE DIGITAL':peak>0.001?'ÁUDIO DETECTADO':pgmSilenceSince!==null&&now-pgmSilenceSince>=3000?'SEM ÁUDIO HÁ 3 s':'NÍVEL BAIXO / SILÊNCIO';
 const el=$('#pgmAudioState');if(el.textContent!==status)el.textContent=status;pgmAudio.dataset.level=!running?'off':peak>=1?'clip':peak>0.001?'signal':'silent';
 $('#pgmAudioEnable').textContent=running?'Medidores ativos':'Ativar medidores';$('#pgmAudioEnable').disabled=running;
 const listening=running&&!!$('#listenMixer').checked;$('#pgmListen').setAttribute('aria-pressed',String(listening));$('#pgmListen').textContent=listening?'Fones ligados':'Ouvir em fones';
 const labels={idle:'ENVIO PARADO',error:'ERRO NO ENVIO',preparing:'PREPARANDO ENVIO',connecting:'CONECTANDO',sending:'CODIFICADOR ENVIANDO',stopping:'ENCERRANDO ENVIO'};$('#pgmAudioTransport').textContent=labels[liveTx.phase]||'ENVIO PARADO';
}
setInterval(updateProgramAudio,100);updateProgramAudio();
