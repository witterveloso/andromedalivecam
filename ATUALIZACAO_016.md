# Andrômeda Live 0.16 — cada plataforma no seu formato: 16:9 e 9:16 ao mesmo tempo

YouTube, Facebook, Twitch, Kick e LinkedIn exibem a live na horizontal (16:9). Instagram e TikTok exibem na vertical (9:16). Até a 0.15, todos recebiam o mesmo quadro 16:9, e no Instagram ele aparecia pequeno, com faixas.

Agora a mesa gera **duas saídas ao mesmo tempo** e entrega a cada plataforma o formato dela.

## Como usar

Página **Transmissão**:

1. **Destinos.** Cada destino tem o campo **Formato**:
   - Instagram e TikTok entram como **9:16 · vertical**;
   - os demais, como **16:9 · horizontal**;
   - um servidor próprio pode usar qualquer um dos dois.
2. **Saída vertical 9:16.** O cartão mostra a prévia vertical e quais destinos a usam. Escolha o enquadramento:
   - **Recortar:** a imagem ocupa a tela toda do celular. Arraste a prévia (ou use **Esquerda / Centro / Direita**) para escolher a parte do 16:9 que aparece. **Dá para mudar durante a live**, para acompanhar quem está falando.
   - **Inteira · fundo desfocado:** o quadro 16:9 completo no centro, sobre um fundo desfocado da própria imagem. Nada fica de fora, nem GC nem laterais.
   - **Inteira · barras pretas:** o quadro completo, com barras em cima e embaixo.
3. **Resolução vertical:** 720 × 1280 (padrão do Instagram ao vivo) ou 1080 × 1920. **Bitrate vertical:** 4 Mbps por padrão (6 Mbps em 1080 × 1920).
4. **Gravação → Formato da gravação:**
   - **16:9**;
   - **9:16** (pronto para Reels e Stories);
   - **Os dois**: dois arquivos MP4, o vertical com `-vertical` no nome.

Depois é só **▶ TRANSMITIR**.

## Como funciona

- O PROGRAM continua sendo montado em 16:9. A saída vertical é montada quadro a quadro a partir dele, já com GC, logotipo, PiP e mosaico.
- **Duas codificações independentes**, uma por formato, cada uma com seus destinos e sua gravação. Uma saída que só tem destinos 16:9 não gasta nada com a vertical, e vice-versa.
- **Se a saída vertical cair, a 16:9 continua no ar** (e vice-versa). O destino afetado aparece como **SAÍDA PAROU**, com o motivo, e a outra saída segue normalmente.
- A reserva de upload sugerida soma os dois formatos. Exemplo: YouTube 1080p a 6 Mbps + Instagram 720p a 4 Mbps = cerca de 13 Mbps de upload estável.
- Instagram e TikTok continuam usando a URL e a chave copiadas da própria plataforma.

## Cuidados

- No modo **Recortar**, o que estiver nas laterais do 16:9 fica fora do quadro vertical, como GC na lateral ou logotipo no canto. Confira na prévia ou use **Inteira · fundo desfocado**.
- Duas codificações usam mais processador. Num computador modesto, prefira 720p nas duas, ou o codificador de placa de vídeo (NVIDIA, Intel ou AMD), se aparecer na lista.
- Resolução e bitrate vertical valem a partir da próxima transmissão. O enquadramento muda ao vivo.

## O que foi testado

- Testes automáticos:
  - formato padrão por plataforma (Instagram e TikTok 9:16, os demais 16:9);
  - grupos de codificação;
  - formatos da gravação.
- Envio real para dois servidores RTMP locais:
  - o destino 16:9 recebeu **1280×720** e o 9:16 recebeu **720×1280**;
  - dois MP4 gravados, um em cada formato;
  - nenhuma chave na auditoria.
- Falha isolada: a saída vertical recebeu dados inválidos e parou, o destino vertical foi marcado como parado, e a saída 16:9 continuou no ar.
- Ensaio pela mesa no navegador (Chromium):
  - dois destinos (16:9 e 9:16) mais gravação dos dois formatos;
  - recorte arrastado durante a live;
  - os servidores receberam 1920×1080 e 720×1280;
  - gravações em 1920×1080 e 720×1280.
- **Ainda não testado com as contas reais do Instagram e do TikTok.** Faça uma live de teste privada antes da primeira transmissão.
