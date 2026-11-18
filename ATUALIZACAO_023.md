# Andrômeda Live 0.23 — TRILHA: música de fundo no ar

## 0.23.0
- **Novo comando TRILHA** nos Comandos (atalho **T**; **PRÓXIMA FAIXA** no atalho **N**). A trilha vai **direto ao ar**, sem passar pelo PREVIEW e por cima de qualquer fonte, e entra no mesmo áudio do AR (transmissão e gravação).
- **Fade já programado:** ao ligar, a música entra com **FADE IN de 2 s**; ao desligar, sai com **FADE OUT de 3 s**. Os tempos (0 a 30 s) são ajustáveis no painel. Ligar de novo continua **de onde parou** (opção).
- **Painel "Trilha · Música de fundo"** com **playlist**: adicione várias músicas de uma vez (MP3, WAV, OGG, M4A/AAC, FLAC, OPUS…) ou arraste para o painel; ordene com ↑ ↓, remova com ×, clique numa faixa para ir a ela. Volume próprio, medidor de nível, relógio da faixa e barra de progresso.
- **Troca suave entre faixas** (crossfade, 2 s por padrão) e avanço automático; ordem **em sequência repetindo**, **aleatória** ou **uma vez só**. Faixa que não toca é pulada e a mesa avisa o motivo.
- **Streaming e plataformas — o que dá e o que não dá:**
  - **Rádios na internet e arquivos de áudio por link:** cole o endereço (MP3/AAC, também listas .pls e .m3u). O serviço local busca o áudio (o navegador sozinho não consegue, por causa da proteção entre sites). Só aceita endereços públicos, e a mesa mostra a razão quando o link falha (não é áudio, rádio fora do ar, transmissão HLS .m3u8 que não é suportada).
  - **Entrada de áudio** (placa de som, mesa de som, **cabo virtual** como o VB-Cable): é o caminho para tocar **Spotify, Apple Music, Deezer, YouTube Music** etc.: a música toca no aplicativo da plataforma neste computador, o som é enviado a uma entrada de áudio e a trilha o coloca no ar com fade in e fade out. Não há integração direta com essas plataformas porque o áudio delas é protegido (DRM) e os termos de uso não permitem transmitir a música ao vivo; além disso YouTube e Facebook podem silenciar ou derrubar uma live com música sem licença. **Use músicas licenciadas para transmissão ou livres de direitos** (ex.: YouTube Audio Library, Pixabay, Free Music Archive), que funcionam como arquivos.
  - Links e entradas ficam salvos; as músicas adicionadas como arquivo ficam carregadas enquanto a mesa estiver aberta.
- **Celular (controle remoto):** a linha **TRILHA** liga e desliga (com fade) e passa para a próxima faixa.
- O painel entra ao lado do Slides, no fim da Operação; quem tem layout salvo mantém o seu e encontra o painel no fim da página. Em Comandos já arrumados os botões entram ao lado dos de SLIDES.
