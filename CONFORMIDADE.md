# Andrômeda Live — Conformidade técnica da transmissão

Este documento lista as diretrizes técnicas publicadas pelas plataformas de transmissão ao vivo e mostra como a Andrômeda Live atende cada uma. Também diz onde cada item é verificado automaticamente. Ele vale a partir da versão 0.28.0.

## 1. Regra do produto

**Toda transmissão sai em 1920×1080 (ou 3840×2160) a 30 quadros por segundo constantes.** A saída vertical 9:16 sai em 1080×1920.

- **Nunca abaixo de 1080p30.** Não existe perfil, teste ou regulador que reduza a resolução para 720p ou 540p.
- **Computador no limite.** Quando a mesa não consegue desenhar 30 imagens novas por segundo, a saída continua 1080p a 30 fps: o codificador repete o último quadro e a mesa entra em modo leve.
- **Codificador sem capacidade.** Se o codificador do computador não produzir 1080p a 30 quadros por segundo, a transmissão não é aberta e a mesa explica o motivo.
- **Serviço local.** O serviço também aplica a regra: qualquer envio com destinos é forçado a 1080p, ou 4K quando pedido, com no mínimo 6 Mbps.

## 2. Diretrizes das plataformas e como a Andrômeda atende

| Item | Diretriz publicada | Andrômeda Live |
|---|---|---|
| Codec de vídeo | H.264 (YouTube, Meta, Twitch) | H.264 **High**, nível **4.1** em 1080p30 (Meta pede 4.1) e 5.1 em 4K |
| Controle de bitrate | CBR (YouTube, Twitch) | `bitrateMode: 'constant'` (WebCodecs) / `-b:v = -minrate = -maxrate` (FFmpeg) |
| Quadro-chave | 2 s, nunca acima de 4 s (YouTube, Meta, Twitch) | 60 quadros = **2 s** |
| Taxa de quadros | constante | **30 fps CFR** (`-fps_mode cfr`; o motor próprio carimba cada quadro pelo relógio) |
| Áudio | AAC-LC, 44,1 ou 48 kHz, estéreo, 128–256 kbps (Meta) | **AAC-LC 48 kHz estéreo 160 kbps** |
| Protocolo | RTMPS (obrigatório na Meta, recomendado no YouTube) | YouTube, Facebook, Instagram e Twitch já vêm com **rtmps://**; destino em rtmp:// aparece com aviso |
| Bitrate 1080p30 | YouTube: faixa ampla, até ~14 Mbps · Meta/Facebook: até ~6 Mbps · Twitch: até ~6 Mbps | Mínimo de 6 Mbps. Com Facebook, Twitch, LinkedIn, Instagram ou TikTok ligados, o bitrate fica em **6 Mbps**; com Kick, em 8 Mbps. Os outros destinos não têm teto |
| Identificação do software | YouTube Live Verified: marca e versão no `flashVer` (RTMP) | Todo destino envia `flashVer = AndromedaLive/<versão>` |
| Acesso ao painel ao vivo | YouTube Live Verified: sala de controle a um clique | Cada destino tem o link “Abrir o painel ao vivo” (YouTube, Facebook, Twitch, LinkedIn e Kick) |

## 3. Envio para várias plataformas ao mesmo tempo

- **Uma codificação por formato.** Há uma codificação 16:9 e uma 9:16. A codificação de cada formato vai para todos os destinos daquele formato, sem codificar de novo para cada plataforma.
- **Uma conexão própria por destino (Saídas Andrômeda, 0.32).** O codificador entrega a imagem pronta ao distribuidor do serviço, que mantém uma conexão por destino (RTMP, RTMPS, SRT) só copiando o vídeo e o som. Cada destino tem sua fila (~20 s em 6 Mbps): uma trava da rede ou da plataforma passa sem perder quadros nem quadro-chave (`test/saidas.test.cjs`: trava de 3,5 s, 359–360 de 360 quadros, quadro-chave a cada 2 s, o outro destino com 360 de 360). Só uma trava mais longa descarta, e apenas naquele destino, até o próximo quadro-chave. A reconexão é automática (1, 2, 4, 8 e depois a cada 15 s) e recomeça num quadro-chave. Cada destino entra e sai do ar sozinho com a live rodando, e quem entra começa pelo último quadro-chave guardado.
- **Falha isolada.** Se um destino cair, os outros continuam no ar.
- **Formatos independentes.** O 16:9 e o 9:16 rodam em processos separados: a queda de um não derruba o outro.
- **Painel de conformidade.** A página **Transmissão** mostra, antes de entrar no ar:
  - o que cada destino vai receber;
  - o bitrate ajustado ao limite das plataformas ligadas;
  - os destinos sem criptografia;
  - o upload necessário.

## 4. Prova técnica automática (CI a cada versão)

O ensaio `test/transmission-electron.cjs` roda no Windows com o Electron real. A mesa é aberta com três vídeos Full HD, faz cortes e créditos, e transmite para um servidor RTMP local enquanto grava. Depois o ensaio mede **o que o servidor recebeu**:

- H.264 **High**, **1920×1080**, **30 fps**;
- AAC **LC**, **48 kHz**, **estéreo**;
- intervalo máximo entre quadros-chave **≤ 2,1 s**;
- pelo menos 28,5 quadros codificados e 28,5 composições novas por segundo;
- transmissão e gravação com os mesmos quadros (diferença de no máximo 3);
- nenhum erro de JavaScript na mesa durante o envio.

Medição no contêiner de desenvolvimento, sem placa de vídeo, na versão 0.28.0: H.264 High 1920×1080 30 fps, AAC-LC 48 kHz estéreo, quadro-chave a cada 2,0 s.

## 5. Certificação: YouTube Live Verified

O YouTube mantém o programa **YouTube Live Verified** para softwares e equipamentos de transmissão. Os critérios cobrem usabilidade, transmissão e confiabilidade, e o fabricante se inscreve por um formulário. Pré-requisitos publicados:

1. Identificação clara de marca e versão no `flashVer` (RTMP) ou `User-Agent` (HTTP). **Atendido** (`AndromedaLive/<versão>`).
2. Link da transmissão ativa e da Sala de controle ao vivo a no máximo um clique. **Atendido** (“Abrir o painel ao vivo do YouTube”).
3. A marca do programa só pode ser usada depois da certificação e dos contratos assinados.

**A inscrição precisa ser feita pela empresa** dona do produto, no formulário da página do programa. Nenhum código substitui esse passo.

## 6. Fontes

- YouTube — Choose live encoder settings, bitrates, and resolutions: https://support.google.com/youtube/answer/2853702
- YouTube — Live Verified: https://support.google.com/youtube/answer/6259875 · Pré-requisitos: https://support.google.com/youtube/answer/6259859
- Meta — Live Video API, reference: https://developers.facebook.com/docs/live-video-api/reference
- Twitch — Broadcast recommendations: https://twitch.tv/creatorcamp/en/paths/going-live/broadcast-recommendations
