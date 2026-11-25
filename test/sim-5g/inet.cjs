// Na "internet": ponto de encontro (broker) e a página do app da câmera (no lugar do GitHub Pages).
const R=require('path').join(__dirname,'..','..')+'/', fs=require('fs'), path=require('path'), https=require('https');
const { startRede } = require(R+'andromeda-rede.cjs');
(async()=>{
  const rede = await startRede({ port: 34950, bind: '0.0.0.0', onEvent: () => {}, ...(process.env.TURN_SECRET?{turnSecret:process.env.TURN_SECRET,turnPort:3478,publicIp:'203.0.113.5'}:{}) });
  https.createServer({key:fs.readFileSync(__dirname+'/key.pem'),cert:fs.readFileSync(__dirname+'/cert.pem')},(q,s)=>{let f=path.join(R,'docs',decodeURIComponent(q.url.split(/[?#]/)[0]));if(fs.existsSync(f)&&fs.statSync(f).isDirectory())f=path.join(f,'index.html');if(!fs.existsSync(f)){s.writeHead(404).end();return}
    s.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.html')?'text/html':f.endsWith('.json')||f.endsWith('.webmanifest')?'application/json':'application/octet-stream');s.end(fs.readFileSync(f))}).listen(3191,'0.0.0.0');
  const tls={key:fs.readFileSync(__dirname+'/key.pem'),cert:fs.readFileSync(__dirname+'/cert.pem')};const w=https.createServer(tls,(q,s)=>s.writeHead(404).end());w.on('upgrade',(q,so,h)=>q.url==='/mqtt'?rede.broker.upgrade(q,so,h):so.destroy());w.listen(34951,'0.0.0.0');
  console.log('internet pronta');
})();
