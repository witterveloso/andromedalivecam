# Publicação: GitHub + servidor público

## 1. Enviar ao GitHub

Crie um repositório `andromeda-cam` na sua conta. Extraia este ZIP. Em Add file → Upload files, envie as pastas e arquivos extraídos à raiz e faça o commit na branch `main`. Inclua `.github/workflows`. Também é possível usar GitHub Desktop para publicar a pasta inteira.

Não envie `node_modules` nem configurações privadas. O workflow Validate Andromeda executa os testes e verifica a construção da imagem Docker. O workflow Publish Andromeda Cam é opcional; se não usar Pages, pode desabilitá-lo na aba Actions.

## 2. Preparar um VPS Linux

É necessário um servidor ligado continuamente, Docker Engine com Compose, Python 3, e um IPv4 público diretamente atribuído à interface. Se o provedor usar NAT para o IP público, esta configuração exige adaptação do coturn; não use os valores automaticamente.

Crie dois registros DNS A, apontando ao IPv4 público:

- `cam.SEU-DOMINIO` para câmera/gateway.
- `turn.SEU-DOMINIO` para retransmissão WebRTC.

Os nomes acima são exemplos: substitua por nomes de um domínio que você controla. Use DNS sem proxy de CDN no TURN. No início, deixe o gateway também sem proxy para simplificar o teste de HTTPS.

Libere no firewall do provedor e do VPS:

| Portas | Protocolo | Uso |
|---|---|---|
| 80, 443 | TCP | Certificado HTTPS e WebSocket |
| 3478 | UDP e TCP | TURN |
| 49160–49260 | UDP | Mídia retransmitida |

Mantenha o acesso administrativo SSH conforme sua política. Não exponha a porta interna 8080 nem as portas da mesa local.

Clone o repositório no servidor, entre na pasta e execute:

```sh
bash cloud/deploy.sh
```

O assistente pede domínio da câmera, domínio TURN, IPv4 público e URL do GitHub Pages. **Pressione Enter na pergunta do Pages para usar o caminho mais simples: tudo no VPS.** Ele gera segredos aleatórios e os arquivos privados, constrói o gateway e inicia Caddy e coturn.

Verifique:

```sh
cd cloud
docker compose ps
docker compose logs --tail=50
```

O Caddy solicita o certificado para o domínio configurado; DNS e portas precisam estar corretos. Não há um certificado pronto dentro do ZIP.

Com Node 22 instalado, na raiz do projeto execute (substituindo o endereço):

```sh
node scripts/check-gateway.cjs https://cam.SEU-DOMINIO
```

Esse comando verifica apenas HTTPS/saúde, não prova que a mídia atravessa o TURN.

## 3. Conectar a mesa Windows

1. Instale Node.js 22 ou superior no computador da mesa.
2. Extraia o mesmo projeto no computador e execute `npm ci` na pasta.
3. Transfira com segurança `cloud/mesa-cloud.env` do VPS para a raiz da pasta no computador. Esse arquivo autoriza a mesa; não o compartilhe com operadores de câmera.
4. Abra `INICIAR_NUVEM.bat` e mantenha o processo aberto.
5. Abra a mesa em `http://127.0.0.1:3180`.
6. No painel Andromeda Cam, use a origem HTTPS real do gateway, selecione CAM 1–10, nome e perfil; gere o convite e compartilhe.
7. O cinegrafista abre o link no navegador externo do celular, permite câmera/microfone e ativa a câmera. Use fone para intercom.

Os convites ficam no formato `https://cam.SEU-DOMINIO/cam/#TOKEN`. São gerados pela mesa; não monte tokens manualmente. Não precisa instalar Tailscale nem configurar IP no telefone. O computador da mesa também precisa de internet.

## 4. GitHub Pages opcional

Use esta opção somente se quiser hospedar a tela da câmera no GitHub. O gateway e o TURN continuam no VPS.

1. No repositório: Settings → Pages → Source → GitHub Actions.
2. Em Settings → Secrets and variables → Actions → Variables, adicione `GATEWAY_URL` com a origem HTTPS do gateway. É um endereço público, não uma senha.
3. Execute Publish Andromeda Cam em Actions e copie a URL que o GitHub entregar.
4. No VPS, edite `cloud/.env` e preencha `CAM_PAGE_URL` com essa URL completa, incluindo o caminho do repositório e a barra final.
5. Na pasta `cloud`, execute `docker compose up -d`. Gere novos convites.

O workflow publica apenas `docs/`. O cliente usa HTTPS/WSS para o gateway; CORS é permitido somente para a origem configurada. Sem GATEWAY_URL, a página informa que não está conectada e não inicia uma transmissão fictícia.

## 5. Atualizações e manutenção

Faça backup seguro da pasta de configuração privada antes de atualizar. Na raiz do VPS, atualize o código do repositório e execute novamente `bash cloud/deploy.sh`; configurações existentes são preservadas. Reiniciar/recriar o gateway interrompe chamadas e apaga convites: faça fora da transmissão e gere novos convites.

Para encerrar os serviços, na pasta `cloud`: `docker compose down`. Não acrescente `-v` se quiser preservar os certificados. Monitore banda, CPU, memória e custos de tráfego. Um sinal de 5 Mbps corresponde a aproximadamente 2,25 GB por hora em cada sentido transportado, sem contar áudio e overhead; o tráfego TURN cresce com as câmeras que precisam de retransmissão.
