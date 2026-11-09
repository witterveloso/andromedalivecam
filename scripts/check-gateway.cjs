'use strict';
// Only public health. Never takes the administrator secret.
async function main(){
 const u=new URL(process.argv[2]||'');
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('Informe somente a origem HTTPS do gateway');
 const r=await fetch(u.origin+'/health',{signal:AbortSignal.timeout(10000),redirect:'error'});
 if(!r.ok||(await r.json()).ok!==true)throw Error('Gateway não respondeu corretamente');
 console.log('HTTPS e gateway disponíveis. Isto não valida TURN, câmera, áudio ou conexão 5G.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
