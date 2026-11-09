"""Run ON THE LINUX VPS: generates private runtime config, never commits secrets."""
from pathlib import Path
import secrets,re,ipaddress,os
from urllib.parse import urlsplit
root=Path(__file__).resolve().parent
if any((root/name).exists() for name in ['.env','turnserver.conf','mesa-cloud.env']): raise SystemExit('Configuração já existe. Faça backup e revise antes de recriar.')
domain=input('Domínio da câmera, sem https://: ').strip()
turn=input('Domínio TURN, sem protocolo: ').strip()
ip=input('IPv4 público do VPS (diretamente atribuído à interface): ').strip()
for host in [domain,turn]:
 if not re.fullmatch(r'(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?',host):raise SystemExit('Domínio inválido')
if not ipaddress.IPv4Address(ip).is_global:raise SystemExit('Informe um IPv4 público')
page=input('URL completa do GitHub Pages (Enter para hospedar a câmera neste VPS): ').strip()
if page:
 u=urlsplit(page)
 if u.scheme!='https' or not u.hostname or u.username or u.password or u.query or u.fragment or any(c.isspace() or c in '$\"\\' for c in page):raise SystemExit('URL HTTPS da página inválida')
token=secrets.token_hex(32);secret=secrets.token_hex(32)
files={'.env':f'CAM_DOMAIN={domain}\nTURN_HOST={turn}\nCAM_PAGE_URL={page}\nCLOUD_TOKEN={token}\nTURN_SECRET={secret}\n',
 'turnserver.conf':f'''listening-port=3478
listening-ip={ip}
relay-ip={ip}
external-ip={ip}
min-port=49160
max-port=49260
fingerprint
use-auth-secret
static-auth-secret={secret}
realm={turn}
no-tls
no-dtls
no-cli
no-multicast-peers
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
user-quota=64
total-quota=128
max-bps=2000000
log-file=stdout
''',
 'mesa-cloud.env':f'ANDROMEDA_CLOUD_URL=https://{domain}\nANDROMEDA_CLOUD_TOKEN={token}\n'}
for name,content in files.items():
 path=root/name;fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as out:out.write(content)
print('Configurações criadas. Transfira mesa-cloud.env com segurança para a pasta da mesa. Não envie esse arquivo aos cinegrafistas.')
