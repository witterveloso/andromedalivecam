# Andrômeda Live 0.17 — app da câmera com cara de câmera profissional

O app da câmera do celular (o link do convite) foi redesenhado com a organização das câmeras de cinema: parâmetros por cima da imagem, ajuste na própria tela e resultado visível na hora. Ele é atualizado sozinho no GitHub Pages; os celulares recebem a versão nova ao abrir o convite de novo.

## Barra de parâmetros sobre a imagem

No topo do visor ficam **LENTE · FORMATO · ZOOM · WB · EXP · ESTAB**, além de **ISO** e **FOCO** quando o aparelho oferece. Cada um mostra o valor atual em letra grande, e um **A** azul indica que está no automático.

**Toque num parâmetro** e a gaveta de ajuste abre sobre a imagem, translúcida: você mexe e vê o efeito na tela. Toque de novo no parâmetro, ou no ✕, para fechar. Os ajustes que antes ficavam em "Ajustes → Lente e imagem" agora ficam todos aqui.

## Lentes: só as físicas

Os botões mostram apenas as lentes de verdade de cada aparelho, em botões redondos: **0,5×**, **1×**, **Tele** e **Frontal**.

As opções "Auto" do iPhone (câmeras Dupla e Tripla) saíram: elas são combinações virtuais, não lentes. Se o navegador abrir uma delas ao ligar, o app troca sozinho para a lente **1×**.

## Zoom em barra, com movimento programado

- **ZOOM** abre uma **barra para deslizar**. Os botões + e − saíram. A pinça com dois dedos na imagem continua funcionando.
- **Movimento programado:** quatro pontos (**1, 2, 3, 4**).
  - Para gravar: toque em **Gravar ponto** e depois no número. Um ponto vazio grava o zoom atual com um toque.
  - Para ir: toque no ponto, e o zoom vai até ele na **velocidade escolhida**: Rápido 1 s, Médio 3 s, Lento 6 s, Muito lento 10 s, ou a barra de 0,5 a 20 s.
  - O movimento segue uma **curva suave**: começa e termina devagar, como um zoom servo de estúdio. Ele anda em escala logarítmica, o que mantém a velocidade aparente constante, como numa objetiva.
  - **Parar movimento** interrompe na hora; mexer na barra também.
  - Medido: de 1× a 3× em 3 s, sem saltos (1,00 → 1,20 → 1,84 → 2,69 → 2,98 → 3,00).
- Quando o aparelho oferece zoom ao navegador, o zoom é o do aparelho. Senão, é digital (recorte), e a barra mostra "dig".

## Estabilização

- **Do aparelho, quando possível:** se o navegador expuser a estabilização do aparelho, o app usa a do aparelho. Hoje nenhum navegador expõe isso (nem Safari, nem Chrome), por isso ela fica pronta para quando expuserem.
- **Do Andrômeda Cam, nos demais casos:** estabilização eletrônica por **análise de imagem**, sem efeito artificial.
  - Mede o deslocamento da imagem a cada quadro: busca em duas escalas, com precisão subpixel.
  - Separa o **tremor** da **intenção**: panorâmicas e inclinações continuam acontecendo.
  - Desloca uma janela de recorte para cancelar só o tremor.
  - Em parede lisa ou céu, onde não há referência, ela não força correção.
- **ESTAB** tem três opções:
  - **Padrão:** recorta 14% da borda.
  - **Forte:** recorta 22%.
  - **Desligada:** o vídeo sai direto da câmera. É a indicada para tripé.
- Medido com tremor de mão simulado (cerca de 8 px num quadro de 1280):
  - Padrão reduziu para 4 a 6 px;
  - Forte reduziu para cerca de 3 px;
  - a panorâmica foi preservada.

## Segundo plano

O sistema do celular (iPhone e Android) **desliga a câmera de qualquer página da web quando ela sai da tela**. É uma proteção de privacidade do aparelho e não dá para contornar no navegador; no iPhone, nem aplicativos nativos podem filmar em segundo plano. O que o app faz:

- **Mantém a conexão com a mesa** enquanto está fora da tela.
- **Avisa a mesa:** o quadro daquela câmera mostra **CÂMERA EM SEGUNDO PLANO**, em vez de parecer travado, e o aviso fica no registro de eventos e na auditoria.
- **Ao voltar, a câmera religa sozinha** em cerca de 1 s, sem reconectar nem pedir permissão. Medido: "Câmera religada depois de 1 s em segundo plano".
- **Mini janela (PiP):** onde o aparelho oferece, a imagem pode continuar numa janela flutuante ao sair do app. Isso depende do aparelho e do navegador.

Para filmar com o celular sem ficar na tela, a alternativa é o **aplicativo nativo para Android** (pasta `mobile/`), que pode usar um serviço em primeiro plano com notificação. Ele ainda é experimental.

## Mais

- Avisos menores e passageiros durante a operação; erros continuam na tela.
- Ao abrir uma gaveta de ajuste, os avisos se escondem para não cobrir a imagem.

## O que foi testado

- Testes automáticos:
  - lentes físicas, nomes curtos e câmeras virtuais fora dos botões (iPhone em português e inglês, Android);
  - barra de parâmetros, zoom em barra, pontos programados e estabilização;
  - aviso de segundo plano da central para a mesa.
- Navegador (Chromium) com câmera sintética trêmula:
  - estabilização medida como descrito acima;
  - zoom pela barra e pontos 1 a 3 gravados;
  - movimento programado suave e contínuo;
  - balanço de branco manual;
  - câmera suspensa e religada ao voltar.
- **Não testado em celulares reais.** Confira nos aparelhos da produção, principalmente:
  - a estabilização (em mãos e em bastão);
  - o zoom do aparelho (iPhone recente e Android);
  - a mini janela.
