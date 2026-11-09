const {findFFmpeg}=require('./encoder.cjs');
console.log('Node.js:',process.version);let ok=Number(process.versions.node.split('.')[0])>=22;
try{require('ws');console.log('WebSocket: OK')}catch{console.log('WebSocket ausente: execute INSTALAR.bat');ok=false}
const ffmpeg=findFFmpeg();console.log(ffmpeg?'FFmpeg com H.264/AAC: OK':'FFmpeg ausente: reinstale ou defina FFMPEG_PATH para ffmpeg.exe');ok=ok&&!!ffmpeg;process.exitCode=ok?0:1;
