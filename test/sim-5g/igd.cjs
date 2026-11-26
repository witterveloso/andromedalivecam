// Roteador doméstico com UPnP de verdade: responde SSDP e cria o encaminhamento com iptables (DNAT) quando a mesa pede.
const dgram=require('dgram'),http=require('http'),{execFileSync}=require('child_process');
const s=dgram.createSocket({type:'udp4',reuseAddr:true});
s.on('message',(m,r)=>{if(/M-SEARCH/.test(m))s.send(Buffer.from('HTTP/1.1 200 OK\r\nST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\nLOCATION: http://192.168.1.1:5000/desc.xml\r\nUSN: uuid:sim\r\n\r\n'),r.port,r.address)});
s.bind(1900,()=>s.addMembership('239.255.255.250','192.168.1.1'));
http.createServer((q,res)=>{let b='';q.on('data',d=>b+=d);q.on('end',()=>{
  if(q.url==='/desc.xml')return res.end('<root><device><serviceList><service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>/ctl</controlURL></service></serviceList></device></root>');
  const a=/#(\w+)"/.exec(q.headers.soapaction||'')?.[1];
  if(a==='AddPortMapping'){const g=n=>new RegExp('<'+n+'>([^<]*)<').exec(b)[1];const proto=g('NewProtocol').toLowerCase(),port=g('NewExternalPort'),to=g('NewInternalClient')+':'+g('NewInternalPort');
    // Como um roteador real: o mesmo encaminhamento (protocolo + porta externa) é substituído, não duplicado.
    for(const line of execFileSync('iptables',['-t','nat','-S','PREROUTING']).toString().split('\n'))if(line.startsWith('-A PREROUTING')&&line.includes('-p '+proto)&&line.includes('--dport '+port))execFileSync('iptables',['-t','nat',...line.replace('-A PREROUTING','-D PREROUTING').split(' ')]);
    execFileSync('iptables',['-t','nat','-A','PREROUTING','-i','w0','-p',proto,'--dport',port,'-j','DNAT','--to-destination',to]);console.log('encaminhado',proto,port,'->',to);}
  if(a==='GetExternalIPAddress')return res.end('<s:Envelope><s:Body><u:GetExternalIPAddressResponse><NewExternalIPAddress>203.0.113.10</NewExternalIPAddress></u:GetExternalIPAddressResponse></s:Body></s:Envelope>');
  res.end('<s:Envelope><s:Body><u:'+a+'Response/></s:Body></s:Envelope>');});}).listen(5000,'192.168.1.1');
console.log('roteador com UPnP pronto');
