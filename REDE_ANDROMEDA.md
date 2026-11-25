# Rede Andrômeda — câmeras pela internet (Wi-Fi, 4G e 5G) sem serviços de terceiros

A partir da versão 0.29.0, o Andrômeda Cam (app da câmera no celular) envia a imagem pelo 4G/5G do mesmo jeito que pelo Wi-Fi. Tudo passa por **código próprio da Andrômeda**. Não depende de Cloudflare, Google, Twilio nem de servidores MQTT públicos.

## Por que o 5G falhava

- **A operadora esconde o celular.** No 4G/5G, o celular fica atrás de um endereço compartilhado (CGNAT). O caminho direto entre o celular e a mesa não existe: a câmera "conecta", mas a imagem não chega.
- **Falta de retransmissor.** Para a imagem chegar, é preciso um **retransmissor (TURN)**. Até a 0.28, ele vinha desligado por padrão, ou dependia de uma conta Cloudflare.
- **Ponto de encontro de terceiros.** A conversa inicial entre celular e mesa passava por servidores MQTT públicos (HiveMQ, EMQX, Mosquitto). Essa conversa é o "ponto de encontro".

## Como funciona agora

### 1. Retransmissão dentro da própria mesa (padrão, não precisa configurar)

- **Retransmissor próprio.** A mesa liga o **retransmissor Andrômeda** (`andromeda-turn.cjs`: STUN e TURN, RFC 5389/5766, UDP e TCP) na porta **3478**.
- **Porta aberta sozinha.** A mesa pede ao roteador, por UPnP (`upnp.cjs`), para encaminhar a porta 3478 UDP/TCP para o computador. Em seguida descobre o IP público.
- **Credencial temporária.** Cada convite entrega ao celular uma credencial válida por 24 h, assinada com um segredo que nunca sai do computador.
- **No 4G/5G:** o celular manda a imagem para o IP público da mesa, o roteador entrega ao computador e o retransmissor entrega à mesa.
- **No Wi-Fi:** o mesmo retransmissor atende pelo endereço da rede local.
- **Segurança:** o retransmissor da mesa só entrega mídia para endereços da rede local (a própria mesa). Ele nunca vira um retransmissor aberto para a internet.

**O que o operador faz:** na primeira vez, o Windows pergunta se o Andrômeda Live pode receber conexões. Clique em **Permitir**.

**Quando não funciona sozinho:** a tela *Rede móvel (4G/5G)* mostra o motivo e a solução.
- **Roteador com UPnP desligado:** ligue o UPnP, ou encaminhe a porta 3478 UDP e TCP para o IP mostrado.
- **Internet da mesa com CGNAT** (o IP público começa com 100.64 a 100.127): use o servidor da Rede Andrômeda (item 2).

### 2. Servidor da Rede Andrômeda (empresa)

Para mesas atrás de CGNAT, e para não depender de mais ninguém, a empresa roda **um servidor próprio** (`andromeda-rede.cjs`). Ele tem duas partes:
- **Ponto de encontro** (`/mqtt`): celular e mesa trocam a conversa inicial. As mensagens chegam cifradas de ponta a ponta com a chave do convite (AES-GCM); o servidor só repassa bytes e não consegue ler nada.
- **Retransmissão** (porta 3478 UDP/TCP): a mesma do item 1, com IP público. Não tem teto de bitrate por câmera: o coturn antigo limitava a 2 Mbps, o que estragava o 1080p.

**Instalação** (um VPS Linux com Docker, um domínio apontado para ele):
1. `cd cloud && python3 configure.py`. Informe o domínio, o domínio da retransmissão e o IP público. O script gera `.env` e `mesa-cloud.env` com segredos aleatórios.
2. `./deploy.sh`. Sobem três serviços: HTTPS (Caddy), gateway e **rede** (o servidor da Rede Andrômeda).
3. No firewall do servidor, abra: 80 e 443 TCP, 3478 UDP e TCP, e as portas UDP altas da retransmissão.
4. Copie `mesa-cloud.env` para a pasta de dados de cada mesa. A mesa passa a:
   - usar o ponto de encontro da empresa (`ANDROMEDA_RELAY_URLS`). O convite leva esse endereço ao celular (`#r=…&p=wss://…/mqtt`), então nenhum servidor MQTT público é usado;
   - somar a retransmissão da empresa à da própria mesa (`ANDROMEDA_TURN_URLS` e `ANDROMEDA_TURN_SECRET`): a da mesa vem primeiro, a da empresa fica de reserva.

**Saúde do servidor:** `curl -s http://127.0.0.1:8090/health` mostra conexões, mensagens e retransmissões ativas.

## Prova técnica (testes automáticos)

- **STUN próprio** responde com o endereço visto; o FINGERPRINT confere.
- **Autenticação.** Sem credencial: 401 com REALM e NONCE. Credencial vencida ou de outro segredo: recusada. Credencial certa: aloca.
- **UPnP**, contra um roteador simulado: abre UDP e TCP, lê o IP público e reconhece CGNAT.
- **Mesa:**
  - retransmissão própria por padrão;
  - IP público quando o roteador abre a porta;
  - credencial temporária de 24 h;
  - o segredo nunca aparece na tela;
  - nenhum servidor de terceiros.
- **Ponto de encontro**, com o cliente real do app: celular e mesa conversam, e outro convite não escuta a conversa.
- **Mesa e empresa juntas:** a retransmissão da mesa vem primeiro e a da empresa de reserva, com credencial válida.
- **Navegador real** (Chromium), com o celular **sem caminho direto** (só retransmissão, como no 5G): o vídeo chega à mesa a 30 fps, por UDP e por TCP, subindo de resolução normalmente.

## Pendências fora do código

- **Servidor da empresa.** Colocar o servidor da Rede Andrômeda no ar exige um VPS e um domínio da empresa (passo 2). É só necessário para mesas atrás de CGNAT, ou para eliminar também o ponto de encontro público.
- **Teste real.** Falta um teste com um celular em 5G de verdade, na mesa de verdade. Nos testes automáticos, a falta de caminho direto é simulada forçando só retransmissão.
