'use strict';
const {spawnSync}=require('node:child_process');
function validateConfig(input){
 if(!input||typeof input!=='object')throw Error('Configuração ausente.');
 let u;try{u=new URL(input.server)}catch{throw Error('Informe a URL do servidor do YouTube.');}
 const allowed=new Set(['a.rtmp.youtube.com','b.rtmp.youtube.com','a.rtmps.youtube.com','b.rtmps.youtube.com']);
 if(!['rtmp:','rtmps:'].includes(u.protocol)||!allowed.has(u.hostname)||u.username||u.password||u.search||u.hash||!/^\/live2\/?$/.test(u.pathname)||u.port&&!['443','1935'].includes(u.port))throw Error('Use a URL RTMP/RTMPS principal fornecida pelo YouTube Studio, terminando em /live2.');
 const key=String(input.key||'').trim();if(!/^[a-zA-Z0-9_-]{8,256}$/.test(key))throw Error('Informe apenas a chave de stream do YouTube, sem espaços ou URL.');
 const resolution=input.resolution;if(!['720p','1080p'].includes(resolution))throw Error('Esta versão transmite em 720p ou 1080p.');
 const bitrate=Number(input.bitrate);if(!Number.isFinite(bitrate)||bitrate<3||bitrate>20)throw Error('Bitrate deve ficar entre 3 e 20 Mbps.');
 return {target:u.toString().replace(/\/$/,'')+'/'+key,resolution,bitrate,fps:30};
}
function argsFor(c){
 const size=c.resolution==='720p'?'1280:720':'1920:1080';const kb=Math.round(c.bitrate*1000);
 return ['-hide_banner','-loglevel','warning','-nostats','-nostdin','-thread_queue_size','128','-probesize','1000000','-analyzeduration','1000000','-f','webm','-i','pipe:0',
 '-map','0:v:0','-map','0:a:0','-vf',`scale=${size}:flags=bilinear,setsar=1`,'-r','30','-c:v','libx264','-preset','veryfast','-tune','zerolatency','-pix_fmt','yuv420p','-profile:v','high','-g','60','-keyint_min','60','-sc_threshold','0','-b:v',kb+'k','-minrate',kb+'k','-maxrate',kb+'k','-bufsize',(kb*2)+'k','-x264-params','nal-hrd=cbr:force-cfr=1','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709',
 '-c:a','aac','-b:a','128k','-ar','44100','-ac','2','-af','aresample=async=1:first_pts=0','-progress','pipe:3','-stats_period','1','-f','flv','-flvflags','no_duration_filesize','-rw_timeout','15000000',c.target];
}
function findFFmpeg(){
 const candidates=[];if(process.env.FFMPEG_PATH)candidates.push(process.env.FFMPEG_PATH);candidates.push('ffmpeg');try{const path=require('ffmpeg-static');if(path)candidates.push(path)}catch{}
 for(const path of candidates){const v=spawnSync(path,['-hide_banner','-encoders'],{encoding:'utf8',timeout:15000,windowsHide:true});if(v.status===0&&/libx264/.test(v.stdout)&&/\baac\b/.test(v.stdout))return path;}
 return null;
}
function safeError(stderr){if(/Server error|NetStream.Publish|403|401|Authentication|not authorized|Already publishing/i.test(stderr))return 'O YouTube recusou a publicação. Confira a chave e se outra aplicação está usando a mesma transmissão.';if(/Connection refused|Failed to resolve|Connection timed out|I\/O error|Network is unreachable|Error opening output/i.test(stderr))return 'Falha ao conectar ao YouTube. Confira URL, internet, firewall e chave no YouTube Studio.';if(/Invalid data|EBML|does not contain any stream|matches no streams/i.test(stderr))return 'O codificador não recebeu vídeo e áudio válidos. Reinicie o envio no Chrome ou Edge.';return 'O codificador foi interrompido. Confira as credenciais, a conexão e tente iniciar novamente.';}
module.exports={validateConfig,argsFor,findFFmpeg,safeError};
