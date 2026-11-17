# Andrômeda Live 0.19 — operação reorganizada, VT, regressiva, áudio master e controle remoto de câmera

## Operação mais prática

### Comandos (no lugar de "Seleção de fontes")
- O **PREVIEW é escolhido no multiview**: clique na câmera. As fileiras PRV/PGM saíram do painel. Os atalhos 1–9 continuam.
- O painel **Comandos** tem botões de produção, no mesmo estilo da mesa:
  - **GC · Créditos / Chamada / Legenda**, **LOGO** e **PiP**: entram e saem do AR.
  - **REGRESSIVA**: entra **direto no AR** e começa a contar.
  - **VT** e **VINHETA**: vão para o **PREVIEW** (detalhes abaixo).
  - **BLACK** (atalho **F1**): escurece toda a saída do AR em fade; clique de novo para voltar.
  - **BARRAS** (atalho **F2**): barras de cor 75% no AR, com tom de referência de 1 kHz (−18 dBFS) opcional.
- **Clique** executa o comando. **Duplo clique** abre os ajustes daquele comando:
  - GC, LOGO e PiP: abre a página GC e efeitos no ajuste certo.
  - REGRESSIVA: tempo (ex.: 5:00), −30 s/+30 s, pausar e reiniciar.
  - VT: leva até a playlist.
  - VINHETA: escolher o vídeo e o que fazer ao terminar.
  - BLACK: tempo do fade.
  - BARRAS: tom de 1 kHz.
- Cada botão mostra o atalho de teclado no canto. Vermelho = no AR; verde = no PREVIEW.
- O clique no botão espera um instante (cerca de 0,2 s) para reconhecer o duplo clique. O **atalho de teclado** age na hora.

### VT (playlist) e vinheta como fontes
- **VT**: adicione os vídeos na playlist (painel **VT · Playlist**, arraste ou "+ Adicionar VTs") e clique em **VT** (ou **VT → PREVIEW**). O próximo VT da lista vai para o PREVIEW.
- Leve ao AR com **CUT** ou **AUTO**: o vídeo começa a tocar. O áudio dele entra no programa e acompanha a transição, como o de uma câmera em AFV.
- **Ao terminar**, a mesa **volta sozinha para a câmera que estava no AR** antes do VT (com AUTO ou CUT, à sua escolha). Também dá para escolher **disparar o próximo VT** ou **congelar no último quadro**.
- **VINHETA** funciona igual, com um vídeo fixo escolhido no duplo clique.
- O botão mostra o tempo restante (−00:12) enquanto está no AR.
- Com o VT no AR, o tally das câmeras apaga, porque nenhuma câmera está no AR.

### Áudio master (no lugar de "Camadas no ar")
- **Modulação L/R** do áudio geral, **volume master** e **FADE OUT** com tempo ajustável (0,5 a 30 s). Depois do fade, o mesmo botão vira **FADE IN**.
- O **monitor do AR fica só com a imagem**: os medidores saíram de lá.
- Os botões "Ativar medidores" e "Ouvir em fones" saíram de cima do AR. O **áudio liga sozinho** (no programa instalado, ao abrir; no navegador, no primeiro clique). Ao ligar o áudio de uma câmera, ele já entra.
- **Mesa de áudio em outro aparelho**: um botão no painel master gera o link e o QR. No celular ou tablet aparecem:
  - modo **OFF/AFV/ON** e volume de cada fonte;
  - **master** com os níveis;
  - **FADE OUT** com tempo;
  - o som do PGM.

  Cada aparelho novo precisa ser **aprovado na mesa**, e o link de áudio **não opera vídeo**. O link também fica em **Configurações → Mesa na nuvem → Mesa de áudio**.

### Câmeras
- A contagem "X de Y com sinal", o número de monitores e os botões do mosaico ficam **na barra "Câmeras"**, ao lado do título.
- **Duplo clique numa câmera do multiview** abre **Fontes de câmera** já naquele canal.

### Teclado
- **Esc** volta para a página **Operação**, de qualquer página. Dentro de uma janela de ajustes, Esc fecha a janela; na personalização do layout, conclui.
- Em **Personalizar** (Configurações), **Atalhos do teclado** lista todos os comandos: clique no atalho e pressione a tecla (ou uma combinação com Ctrl/Alt). Backspace limpa. Há o botão **Restaurar atalhos padrão**.
- Padrão:

  | Tecla | Comando |
  |---|---|
  | 1–9, − | Câmera no PREVIEW |
  | 0 | Preto no PREVIEW |
  | M | Mosaico no PREVIEW |
  | Espaço | CUT |
  | Enter | AUTO |
  | F1 | BLACK |
  | F2 | BARRAS |
  | F3–F5 | GC 1–3 |
  | F6 | LOGO |
  | F7 | REGRESSIVA |
  | F8 | PiP |
  | F9 | VT no PREVIEW |
  | F10 | VINHETA no PREVIEW |

  O FADE do master fica sem tecla até você escolher uma.
- Em **Personalizar → Botões de comando**: ordem (↑ ↓) e quais botões aparecem no painel Comandos.

## Regressiva
- Contagem sobre o PROGRAM: vai para a transmissão, a gravação e a saída 9:16.
- Estilo **tela cheia** (abertura, com a imagem do PGM escurecida ao fundo) ou **no canto**.
- Texto e cores ajustáveis em **GC e efeitos → Regressiva**.
- **Ao zerar**: mantém 00:00, sai do AR, ou sai e corta (CUT) para o PREVIEW.
- Nos últimos 10 s os números mudam para a cor de destaque.

## Controle de câmera à distância (Andromeda Cam)
- Novo painel **Controle de câmera** na Operação. Por padrão ele **segue a câmera do PREVIEW**, para o diretor enquadrar antes de levar ao AR.
- **Lente**: os botões mostram as lentes físicas do celular, com o tipo (Ultra-angular, Grande-angular principal, Teleobjetiva, Macro, Frontal).
- **Zoom**: barra deslizante, com o mesmo alcance do celular.
- **Enquadramento**: com zoom, arraste o ponto para mover o recorte (ou use as setas do teclado). **Centralizar** volta ao meio.
- O celular mostra **⌖** no ZOOM quando o enquadramento foi ajustado pela mesa.
- Quando a mesa reenquadra, o zoom passa a ser por recorte, porque o zoom do próprio aparelho não se desloca. Por isso a imagem perde um pouco de nitidez nos zooms altos.

## App da câmera
- O **movimento programado de zoom** (pontos 1–4 e velocidade) saiu. Ficou a **barra deslizante** e a pinça com dois dedos.
- **Lentes**: cada botão diz o tipo da lente (toque e segure ou passe o mouse) e a mesa recebe esses nomes. No Android, o modelo do aparelho aparece no painel Controle de câmera quando o navegador informa.
  - **Limitação:** o navegador não informa o fator exato da teleobjetiva (2×, 3×, 5×), por isso ela aparece como "Tele".

## Também nesta versão
- **AUTO não trava com a janela minimizada.** A transição usava o desenho da tela, que o sistema pausa; agora termina mesmo assim, inclusive quando disparada pelo controle remoto.
- Inclui as correções da 0.18.2 e da 0.18.3:
  - transmissão sem falta de vídeo com a janela minimizada;
  - câmeras em 4G/5G com retransmissão TURN;
  - STUN/TURN atuais para a mesa na nuvem.

## O que foi testado
- **Testes automáticos:** 57 do serviço, mais as verificações de interface. Cobrem:
  - painel Comandos, regressiva no AR, VT/vinheta no PREVIEW e no AR;
  - AFV das câmeras durante o VT;
  - F1/F2, atalhos configuráveis, Esc, ordem dos botões;
  - painel master com fade, barra das câmeras e duplo clique para Fontes de câmera;
  - repasse de zoom, lente e enquadramento pela central, com limites;
  - comandos de áudio da mesa remota restritos ao link de áudio.
- **Navegador real (Chromium):**
  - VT de dois vídeos: PREVIEW, CUT, toca, dispara o próximo e volta para a câmera. Conferido pela cor da saída PROGRAM.
  - Vinheta com AUTO e retorno.
  - BLACK e BARRAS conferidos pixel a pixel na saída.
  - FADE OUT e FADE IN de 1 s no master.
  - Celular simulado conectado pelo modo Internet: a mesa recebeu as lentes, deu zoom 2,5× e moveu o enquadramento; o celular aplicou e devolveu; Centralizar voltou ao meio.
  - Mesa de áudio num "celular": link pelo atalho, aprovação na mesa, modo ON e volume 40% na CAM 1, e FADE OUT/IN pelo aparelho.
- **Não testado em celulares reais nem no Windows de produção.** Num ensaio, confira:
  - o controle de câmera num iPhone e num Android;
  - o tempo de resposta da mesa de áudio remota no 4G;
  - os atalhos F1–F10 com o seu teclado (alguns notebooks precisam da tecla Fn).
