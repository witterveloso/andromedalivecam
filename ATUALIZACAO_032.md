# Andrômeda Live 0.32 — Saídas Andrômeda

## Cada destino entra e sai do ar sozinho, com a live rodando
- **Um botão por destino.** Durante a live, cada cartão de destino mostra **▶ Entrar no ar** ou **■ Sair do ar**.
  - Um destino sai do ar sem derrubar nem engasgar os outros, e a plataforma recebe o encerramento correto.
  - Um destino entra no ar no meio da live em poucos segundos, já com a imagem inteira: ele começa pelo último quadro-chave guardado.
- **Três modos para começar a live**, escolhidos em cada cartão:
  - **No ar ao iniciar**;
  - **Em espera**: o formato do destino já fica pronto, e ele entra quando você quiser;
  - **Desligado**.
- **Destino novo durante a live.** É possível adicionar e configurar um destino com a live no ar e pôr no ar em seguida, desde que o formato dele (16:9 ou 9:16) já esteja rodando.
- **Estado real de cada destino:**
  - NO AR, com a taxa medida em Mbps e há quanto tempo está no ar;
  - CONECTANDO, RECONECTANDO (com o motivo), EM ESPERA e FORA DO AR.
- **Reconexão sozinha, destino por destino.** Tentativas em 1, 2, 4 e 8 s, depois a cada 15 s, sempre recomeçando num quadro-chave.
- **Destino lento não segura ninguém.** Cada destino tem a própria fila (~20 s em 6 Mbps). Se a conexão de um travar, só ele pula alguns segundos; a codificação, a gravação e os outros destinos seguem normais.

## Novos protocolos de saída
- **SRT**, para restream, emissoras e servidores na nuvem.
  - Endereço `srt://servidor:porta`, com Stream ID e senha opcionais. A senha liga a criptografia AES.
  - Latência ajustável de 200 a 4000 ms (padrão 2000 ms): o SRT reenvia o que se perde no caminho, ideal para internet instável.
- **WHIP (WebRTC)**, com atraso abaixo de 1 segundo.
  - Basta a URL de ingestão (https://) e, se o servidor pedir, o token.
  - A imagem sai direto da mesa por WebRTC, criptografada (DTLS-SRTP), com H.264 preferido.
  - Cada destino WHIP é mais uma codificação no computador; os destinos RTMP/RTMPS/SRT continuam copiando a codificação única.
- **RTMP e RTMPS** continuam como antes.

## Como funciona por dentro (sistema próprio)
- **Codificação única por formato**, como antes: o codificador 16:9 e o 9:16 codificam a imagem uma vez só.
- **Distribuidor próprio do Andrômeda Live.** Ele recebe a imagem pronta e mantém uma conexão por destino.
  - Cada conexão só copia o vídeo e o som, sem codificar de novo, e por isso quase não usa processador.
  - O distribuidor guarda a configuração do vídeo e do som e o último trecho desde o quadro-chave, como um servidor de transmissão. É isso que permite um destino entrar no meio da live com a imagem inteira.
- **WHIP.** O serviço local faz só a apresentação HTTP com o servidor WHIP: envia a oferta, recebe a resposta e encerra a sessão no fim. Endereços HTTP só são aceitos nesta máquina ou na rede local; na internet, só HTTPS.
- **Pré-voo.**
  - SRT é UDP e não tem "conexão" para testar antes: o pré-voo confere o nome do servidor, e a conexão de verdade aparece no cartão ao entrar no ar.
  - WHIP é testado pela porta HTTPS.

## Provas
- **Testes automáticos com FFmpeg de verdade** (`test/saidas.test.cjs`):
  - um destino entra aos 4 s e outro sai aos 8 s:
    - os dois recebem imagem inteira desde o primeiro quadro;
    - quadro-chave a cada 2 s;
    - nenhum erro de decodificação;
  - SRT com Stream ID e senha recebe a live inteira;
  - destino sem servidor fica em "reconectando (conexão recusada)" e volta ao ar sozinho quando o servidor sobe;
  - destino travado por 3,5 s recebe 359–360 de 360 quadros, com quadro-chave a cada 2 s, e o outro destino recebe 360 de 360.
- **WHIP** (`test/whip.test.cjs`): oferta com token, resposta e Location; DELETE no fim; recusa de token, endereço errado e HTTP fora da rede local.
- **Mesa de verdade no navegador, com o código protegido do instalador:**
  - **No início:** o canal A começa no ar; o canal B, o SRT e o WHIP começam em espera.
  - **Com a live rodando:** B, SRT e WHIP entram no ar; depois A sai do ar e, por fim, o WHIP sai.
  - **Recebido em cada destino:**
    - A: 420 quadros;
    - B: 446 quadros;
    - SRT: 386 quadros;
    - WHIP: 1920×1080 com som.
  - **WHIP:** o servidor recebeu o token e o encerramento (DELETE).
- Os testes de transmissão de ponta a ponta (1080p30, 4K30, saída vertical, gravação com disco travado) passam pelo distribuidor novo.

## Observações
- **A taxa mostrada em cada cartão é a medida de verdade.** Com a mesa parada (sem câmeras ou movimento), o codificador gasta menos que o alvo; com imagem real, ela sobe para o bitrate escolhido.
- **Para entrar no meio da live, o formato do destino precisa estar rodando.** Um destino 9:16 só entra se havia algum 9:16 no ar ou em espera ao começar, porque o formato vertical é mais uma codificação.
