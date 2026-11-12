# Andrômeda Live 0.15 — câmera do celular: tela cheia, lentes, zoom, balanço de branco, exposição e vídeo fluido

Tudo nesta versão acontece na página da câmera (o link do convite que o celular abre). Ela é atualizada sozinha no GitHub Pages: os celulares recebem as novidades ao abrir o convite de novo. Os perfis 1080p60 e 4K da mesa vêm no instalador 0.15.

## Tela cheia

- **Android e computador:** o botão **⛶** no topo liga e desliga a tela cheia. Ela também liga sozinha ao ativar a câmera; dá para desligar isso em Ajustes.
- **iPhone:** o Safari não deixa uma página ocupar a tela inteira. A solução é instalar o app na Tela de Início, que abre sem nenhuma barra do navegador:
  1. Abra o convite no Safari e toque em **⛶**, ou em Ajustes → **Tela cheia no iPhone**.
  2. Com o aviso aberto, toque em **Compartilhar** (quadrado com seta) → **Adicionar à Tela de Início**.
  3. Abra o **Andrômeda Cam** pelo ícone novo.
  - O convite vai junto no ícone, e o app lembra o último convite.
  - Convite novo: abra o link novo no Safari e repita, ou cole o convite em Ajustes, dentro do app.

## Lentes de cada aparelho

As lentes aparecem com o nome que o aparelho informa, nesta ordem:

- **0,5× Ultra**;
- **1× Principal** (antes aparecia como "Lente 4");
- **Tele**;
- automáticas do iPhone, que trocam de lente sozinhas conforme o zoom:
  - **Auto · 3 lentes**;
  - **Auto · 0,5–1×**;
  - **Auto · 1×–Tele**;
- **Frontal**.

Funciona com os nomes do iPhone em português e em inglês e com os do Android. Câmeras sem nome reconhecível aparecem como "Câmera N".

## Zoom

- Junto das lentes, o controle **+ 2,0× −** muda o zoom. Tocar no valor volta a 1×. A pinça com dois dedos sobre a imagem também funciona.
- Quando o aparelho oferece zoom ao navegador (Chrome no Android, e iPhones recentes), o zoom é **do aparelho**. Nas lentes automáticas do iPhone, isso inclui trocar de lente física.
- Quando não oferece, o zoom é **digital**, de 1× a 4×: um recorte da imagem antes do envio, marcado como "dig". Ele perde nitidez; para aproximar sem perda, prefira a lente Tele.

## Balanço de branco e exposição manuais

Ficam em **Ajustes → Lente e imagem**. Cada controle diz se é **no aparelho** ou **digital, neste celular**.

- **Balanço de branco:**
  - Automático ou Manual;
  - no manual, temperatura da luz de 2500 K a 9000 K, com atalhos: Tungstênio 3200, Fluorescente 4000, Dia 5600, Nublado 6500, Sombra 7500;
  - no modo digital, também há o **matiz** (verde ↔ magenta).
- **Exposição:**
  - Automática ou Manual;
  - no manual, compensação de −2 a +2 EV;
  - quando o aparelho oferece, também aparecem **ISO** e **obturador**.
- **Foco** (automático contínuo, único ou manual com distância) e **Lanterna** aparecem quando o aparelho oferece.
- **Voltar tudo ao automático** desfaz os ajustes.
- No visor, um resumo mostra o que está fora do automático, por exemplo `2,0× dig. · WB 3200K · +1.5 EV`.
- Os ajustes ficam salvos no celular e voltam ao trocar de lente.

Sobre o modo digital:
- É usado no iPhone, cujo Safari não expõe esses controles.
- A imagem é processada no celular (WebGL) antes de ir para a mesa, e gasta um pouco mais de bateria.
- Clarear a imagem não recupera céu estourado nem sombra sem detalhe.
- Com tudo no automático, o vídeo sai direto da câmera, sem processamento.

## Ajustes valem na hora

- **Resolução** e **quadros/s** são aplicados com a câmera ligada, sem reconectar. Se o aparelho não muda o formato ao vivo, a câmera reabre sozinha.
- O app avisa o formato real entregue, por exemplo "Este aparelho entregou 1920×1080 · 30 fps".
- **Microfone** é trocado sem derrubar o vídeo, inclusive no intercom.
- **Bitrate** continua valendo na hora, agora até 25 Mbps.
- Ao conectar, o perfil do convite da mesa é o ponto de partida.

## Vídeo fluido em 1080p e 4K

- **Quadros primeiro:** se a rede ou o processador apertarem, o envio reduz a nitidez e mantém os quadros por segundo, em vez de travar o movimento.
- **Codificador de hardware:** o envio prefere H.264, que iPhones e a maioria dos Android codificam no chip. Em 1080p60 e 4K, o codificador por software não acompanha.
- **Prioridade alta** para o vídeo e quadros por segundo travados no valor escolhido.
- O **processamento digital** é limitado a 1080p. Em 4K, com zoom, cor ou brilho digitais ligados, o envio cai para 1080p e continua fluido. Sem ajuste digital, o 4K sai direto da câmera.
- **Perfis novos no convite da mesa:**
  - 1080p · 60 fps · 8 Mbps;
  - 4K · 30 fps · 16 Mbps.

  Os anteriores continuam: 720p · 3 Mbps e 1080p · 5 Mbps.
- Medido em navegador com câmera simulada (20 fps):
  - envio direto a 20 fps;
  - com zoom e exposição digitais, também 20 fps e na mesma resolução.
  - Nos primeiros ~10 s após conectar, a nitidez sobe aos poucos enquanto a conexão mede a rede. Isso é normal do WebRTC.

## Limites

- 4K exige celular que filme 4K pelo navegador, rede com folga (16 Mbps de upload no celular e de download na mesa) e um computador da mesa com folga para decodificar. Para várias câmeras ao mesmo tempo, 1080p é o recomendado.
- Os nomes e controles dependem do que cada navegador expõe; o modo digital cobre o que faltar.
- **Não testado em aparelhos reais** (iPhone, Android): só em navegador com câmera simulada. Faça um ensaio com cada modelo antes da live.
