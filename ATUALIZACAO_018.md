# Andrômeda Live 0.18 — gravação em 16:9 e 9:16

## 0.18.1 — prévia dos efeitos acompanha a rolagem

Na página **GC e efeitos**, a **Prévia dos efeitos** agora acompanha a barra de rolagem:
- ao descer ou subir a página para mexer nos ajustes (GC, logotipo, PiP), a prévia fica presa logo abaixo do menu do topo, ao lado dos ajustes;
- em telas mais baixas, como notebooks, a imagem da prévia diminui para caber inteira na altura da tela;
- no celular, onde os painéis ficam um embaixo do outro, a prévia continua no lugar normal.

Testado no navegador em 1600×900, 1366×680 e 420×860, rolando para baixo e para cima, inclusive com o mouse sobre a prévia.

## 0.18.0

A gravação passa a sair nos dois formatos por padrão: um arquivo horizontal para YouTube, Facebook e edição, e um vertical para Instagram, TikTok, Reels e Shorts.

## Gravação nos dois formatos

- Em **Transmissão → Gravação → Formato da gravação**, a primeira opção agora é **16:9 e 9:16 · dois arquivos**, e ela já vem marcada.
  - Quem já usava a mesa também passa para "os dois" na primeira abertura da 0.18.
  - Dá para voltar a gravar um formato só: **Só 16:9** ou **Só 9:16**.
- Funciona nos três modos: **Transmitir e gravar**, **Só transmitir** e **Só gravar**.
  - Em **Só gravar**, a mesa grava os dois formatos sem precisar de nenhuma plataforma configurada.
- O vertical segue o enquadramento do card **Saída vertical 9:16**:
  - recorte com posição ajustável;
  - imagem inteira com fundo desfocado;
  - imagem inteira com faixas.
- A resolução do vertical é a desse card: 720×1280 (padrão) ou 1080×1920.

## Arquivos com o formato no nome

- `Andromeda_2026-11-12-20-30-00_16x9.mp4`: horizontal, na resolução da transmissão (1280×720 ou 1920×1080).
- `Andromeda_2026-11-12-20-30-00_9x16.mp4`: vertical.

Os dois arquivos começam e terminam juntos, com o mesmo áudio. Cada um tem o próprio codificador: se um falhar, o outro continua gravando, e a mesa avisa qual parou.

Ao parar, **Última gravação** mostra os dois arquivos com o tamanho de cada um. O registro de eventos e a auditoria anotam cada arquivo com o formato.

A estimativa de espaço ("GB por hora" e "horas de gravação") passa a somar os dois arquivos.

## Aviso de computador sobrecarregado

O codificador conta os quadros que o navegador deixou de entregar. Se faltarem mais de 40% dos quadros por 5 segundos seguidos, a mesa avisa na barra de status, no registro e na auditoria:

> Atenção: o computador está entregando poucos quadros para a saída 16:9 (a imagem fica travando na gravação e na transmissão). Feche programas pesados ou use 720p.

O aviso aparece no máximo uma vez por minuto para cada formato. Antes, o problema só aparecia depois, ao assistir ao arquivo.

## O que foi testado

- **Gravação real com a mesa no navegador**, em Só gravar com o padrão novo:
  - saíram dois MP4 (H.264 + AAC), 1920×1080 e 720×1280;
  - os dois têm a mesma duração e imagem;
  - não sobrou nenhum arquivo .mkv.
- **Testes automáticos com FFmpeg de verdade:**
  - só gravar nos dois formatos, em 1080p: 1920×1080 e 1080×1920, vídeo e áudio com a mesma duração;
  - transmitir e gravar ao mesmo tempo: 16:9 para uma plataforma, 9:16 para outra, e os dois arquivos;
  - o aviso de quadros faltando aparece com sinal pela metade e não aparece com sinal completo.
- Um cliente antigo, que não informa o formato, continua gravando só 16:9, sem erro.
- **Não testado num PC Windows de produção.** Num ensaio, grave 10 minutos em "16:9 e 9:16" e confira:
  - os dois arquivos;
  - se o aviso de poucos quadros não aparece;
  - o espaço em disco, que fica em cerca de 4,6 GB por hora em 1080p com o vertical em 720p.
