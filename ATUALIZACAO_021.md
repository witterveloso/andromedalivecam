# Andrômeda Live 0.21 — Motor Andrômeda: nossa própria tecnologia de transmissão

## 0.21.5
- **Botões de COMANDOS personalizáveis.** Em *Personalizar*, o painel Comandos ganha uma barra de ajuste:
  - **Arrastar para trocar de lugar:** pegue um botão e solte antes ou depois de outro; uma marca azul mostra onde ele vai entrar. A ordem também continua no *Ajustes → Comandos*.
  - **Tamanho dos botões:** barra de **50% a 200%** (de 5 em 5), com o valor ao lado. O texto acompanha o tamanho.
  - **Botões por linha:** de 2 a 8.
  - **Botão largo:** o **⇔** no canto do botão faz ele ocupar duas colunas (bom para BLACK ou VT); também há a opção *largo* em *Ajustes → Comandos*.
  - **Restaurar** volta à ordem e ao tamanho padrão.
  - No *Personalizar* os botões **não disparam nada**: clique ou arraste ali nunca muda o AR. Fora dele, tudo funciona como antes. A escolha fica salva e volta ao abrir a mesa.
- **Vinheta em LOOP.** No ajuste da vinheta (duplo clique em VINHETA) há a opção **LOOP: repetir direto até tirar do AR**. Com ela ligada, a vinheta repete sem parar quando vai ao AR e só sai quando o operador corta para outra fonte (CUT/AUTO). O botão mostra **↻** e "LOOP". Dá para ligar ou desligar com ela no ar: desligando, ela termina a passada e a mesa volta sozinha para a câmera. A escolha fica salva.

## 0.21.4
- **Dois monitores (segunda tela).** Em *Personalizar*, cada painel pode ir para a **Segunda tela** (coluna *Página*), e há o modelo pronto **Duas telas** (câmeras, mixer e intercom na segunda tela; comandos, monitores, áudio master, corte e VT na principal).
  - **Abrir segunda tela** (em Personalizar e na barra de edição) abre a janela com esses painéis. **No programa instalado ela abre sozinha no outro monitor**, maximizada; F11 deixa em tela cheia. Na primeira vez, se nenhum painel estiver marcado, o botão já aplica o modelo Duas telas.
  - Os painéis são **movidos, não copiados**: câmeras, vídeo, áudio e medidores continuam funcionando lá. **Os atalhos de teclado valem também na segunda tela** (Espaço CUT, Enter AUTO, F1 BLACK, F2 BARRAS…), menos quando se digita num campo.
  - Na segunda tela também dá para **arrastar** os painéis pelo título e mudar o tamanho pelo canto, como na principal.
  - Fechando a janela, os painéis voltam para a mesa (guardados, funcionando) e aparece um aviso com o botão para reabrir.
- **Medidores de áudio no estilo da referência do operador:** barras arredondadas que enchem em degradê contínuo (verde na base, amarelo e vermelho na ponta), sem segmentos.
  - **Mixer de áudio:** um canal por fonte, lado a lado, com o medidor alto, o **nome curto embaixo** (CAM 1, BM CAM…; o nome completo aparece ao passar o mouse) em verde, e o estado: **MUTE** em vermelho quando a fonte está em OFF (barra apagada e nome em cinza), **AFV** ou **ON** nos outros casos. Modo e volume continuam embaixo de cada canal; "Reiniciar vídeo" só aparece para fontes que são arquivos de vídeo.
  - **Áudio master:** L e R no mesmo estilo, com o pico em dBFS e o nome do canal embaixo.
  - A altura da barra continua sendo o pico real em dBFS (−60 a 0). Chegar a 0 dBFS (limite digital) acende a borda vermelha e o selo PEAK.

## 0.21.3
- **Mesa no Padrão novo: comandos à esquerda, PREVIEW e PGM no meio, áudio master à direita.** Quem estava com o Padrão antigo passa ao novo sozinho; um layout mexido pelo operador fica como está (e o Padrão novo pode ser escolhido em *Personalizar → Modelo*).
- **PREVIEW e PGM iguais e alinhados:** o PGM ganhou a mesma faixa de informação embaixo da imagem (fonte no ar e estado do sinal; com VT no ar mostra o nome e NO AR ou PAUSADO). Antes só o PREVIEW tinha a faixa e a imagem do PGM ficava 22 px mais baixa.
- **Comandos do VT na mesma linha:** VT, PRÓXIMO VT, PAUSAR VT e PARAR VT ficam sempre juntos numa linha; os comandos ocupam o painel inteiro, sem rolar, e nomes longos quebram em duas linhas em vez de serem cortados.
- **Playlist do VT:**
  - **Fim natural:** a mesa volta para a câmera e o **próximo da lista já fica armado**.
  - **VT interrompido** (PARAR, CUT ou AUTO antes do fim): **nada avança sozinho**; o mesmo VT continua armado e o operador arma o próximo à mão (clique na lista ou **PRÓXIMO VT**). O registro avisa.
  - **VT** leva o VT armado ao **PREVIEW**; ele toca quando vai ao AR com CUT ou AUTO.
  - **PRÓXIMO VT** sem VT no AR **arma o seguinte** da lista (o botão mostra qual, por exemplo `armar 3/5 · Encerramento`) sem mexer no PREVIEW; com VT no AR continua trocando na hora para o seguinte.
- **VUs modernos (LED)** em verde, amarelo e vermelho (verde até −18 dBFS, amarelo de −18 a −6, vermelho de −6 a 0), com os segmentos apagados à vista, brilho no nível e marca de pico branca. No áudio master (à direita) o L e o R ficam em barras verticais.

## 0.21.2
- **Botão PiP de volta** no painel Comandos (atalho F8). Na 0.21.1 ele foi retirado por engano: o que devia sair era a **janela do monitor "KEY 1 · PiP"** que ficava na mesa.
- **Janela do KEY 1 (PiP) retirada da mesa.** O PiP continua funcionando normalmente (botão, F8 e *GC e efeitos*), só não há mais a janelinha de monitor, e a mesa deixa de desenhá-la a cada quadro.

## 0.21.1
- **Botão PRÓXIMO VT** no painel Comandos, ao lado do VT (atalho **⇧F9**, configurável): dispara o próximo VT da playlist sem descer a página até ela.
  - Com um VT tocando no AR, troca **na hora** para o seguinte, sem sair do AR. No último VT da lista não faz nada e avisa no registro.
  - Sem VT no AR, leva o próximo da playlist ao PREVIEW, como o botão VT.
  - O botão mostra qual VT vem a seguir e a posição na lista (por exemplo, `2/3 · Reportagem`). Em layouts já salvos ele entra logo depois do VT.
- **PAUSAR e PARAR o VT**, no painel do VT e no painel Comandos (botões **PAUSAR VT** e **PARAR VT**; atalhos **⇧F7** e **⇧F8**, configuráveis):
  - **PAUSAR / CONTINUAR:** congela o VT que está no AR (imagem parada e sem som) e retoma do mesmo ponto.
  - **PARAR:** tira o VT do ar com a transição de volta configurada e deixa o **mesmo VT** pronto para começar de novo. (No fim normal do VT, o próximo da lista é que fica pronto.) O antigo botão "Tirar VT do ar" virou este.
  - Sem VT no ar, os dois avisam no registro e não fazem nada.
  - Cada botão traz o **sinal da função antes do nome** (⏸ pausar, ▶ continuar, ■ parar, ⏭ próximo), desenhado pelo programa para ter o mesmo tamanho em qualquer computador.
- ~~Botão PiP retirado~~ (corrigido na 0.21.2: o botão voltou).
- **Logo de cada plataforma nos destinos** (Transmissão): YouTube, Facebook, Instagram, Twitch, Kick, TikTok, LinkedIn e RTMP próprio. O logo aparece no bloco colorido de cada destino, no lugar das duas letras. Marcas desenhadas pelo próprio programa (sem imagens externas), com o nome da plataforma como texto de acessibilidade. O contorno azul do bloco continua marcando os destinos verticais 9:16.

Até a 0.20 o caminho do vídeo era: **navegador codifica VP8 → serviço decodifica → x264 codifica de novo → plataforma**. São duas codificações e uma decodificação por quadro, mais um gravador do navegador que entrega pedaços de 100 ms. É o que pesa em computadores comuns e o que acumula atraso.

A 0.21 traz um caminho novo, **nosso**, que codifica **uma vez só**:

```
mesa (canvas do PGM + mixer de áudio)
  → WebCodecs: H.264 (placa de vídeo quando houver) + Opus      [navegador]
  → empacotador Matroska próprio, pacote a pacote               [navegador]
  → FFmpeg só COPIA o vídeo e converte o som para AAC           [serviço]
  → tee com fila por destino → RTMP/RTMPS + gravação
```

## O que mudou

### 1. Motor Andrômeda (codificação no navegador)
- **Uma só codificação**, no navegador, com o **relógio da mesa**: cada quadro e cada bloco de som recebe o instante em que existiu. Não há mais recodificação, nem gravador de 100 ms, nem decodificação no serviço.
- **Quadro-chave pelo menos a cada 2 s** (o que YouTube, Facebook, Twitch e Kick pedem; o codificador pode pôr um a mais numa troca brusca de cena), 30 quadros/s, taxa constante, sem quadros B (modo tempo real).
- **16:9 e 9:16** continuam independentes: cada formato tem o seu codificador e o seu FFmpeg. Se um cair, o outro segue.
- **Sincronismo automático também no motor novo:** a compensação medida é aplicada nos instantes dos pacotes. Ela é **guardada por motor** (cada motor tem o seu atraso próprio): ao trocar de motor, calibre de novo.
- **Em Transmissão → Codificador → Este computador → Motor de envio:** *Automático (recomendado)*, *Andrômeda* ou *Padrão*. No automático, a mesa testa o navegador na hora de transmitir e usa o Andrômeda se houver H.264 e Opus. O cartão mostra se o H.264 vai pela placa de vídeo ou por software.

### 2. Plano B que não derruba a live
Qualquer falha do motor novo passa a transmissão para o codificador padrão **sem encerrar a sessão**:
- o navegador não tem H.264/Opus, ou a configuração não é aceita → o padrão é usado desde o começo, com aviso no registro;
- o codificador recusa um quadro, dá erro, ou **para de entregar quadros por 4 s** (8 s no começo) → o navegador avisa o serviço, o FFmpeg é trocado e a transmissão continua com o padrão. A gravação continua em arquivo novo (`…_p2.mp4`), nunca sobrescreve a anterior;
- o envio ao serviço local acumula → mesma troca.

A **autorrecuperação da 0.20** vale nos dois motores: se o FFmpeg cair, o serviço o reinicia, o navegador manda um cabeçalho novo e um quadro-chave na hora, e a imagem volta sem esperar 2 s.

### 3. Correção encontrada nos testes: gravação perdida quando o FFmpeg cai
Com imagem parada (bitrate baixo) o arquivo de gravação ficava no buffer do FFmpeg e **se o codificador caía, a primeira parte da gravação saía vazia**. Agora cada pacote é gravado na hora (`flush_packets`), nos dois motores.

### 4. Mixer a 48 kHz
O mixer de áudio da mesa abre a 48 kHz (o que o Opus e o AAC usam), sem reamostragem escondida.

## Medido (mesmo computador de teste, mesma mesa, 720p, 4 Mbps, 3 rodadas cada)

| | Motor padrão | **Motor Andrômeda** |
|---|---|---|
| Atraso da mesa até a saída RTMP (mediana) | 858 · 953 · 964 ms | **93 · 92 · 118 ms** |
| Pior atraso medido | até 2,3 s | 131 ms |
| CPU do computador durante a live | 3,75 de 4 núcleos | **2,0 de 4 núcleos** |
| Clarões que chegaram ao receptor | 7–9 de 10 | **10 de 10** |
| Sincronismo som/imagem no arquivo | 19 a 39 ms, dispersão até 33 ms | **−28 a +13 ms, dispersão 0** |

- O computador de teste é um ambiente de nuvem de 4 núcleos **sem placa de vídeo e saturado pelo motor padrão**: em um PC mais forte o padrão fica melhor do que aqui, mas o Andrômeda faz estruturalmente menos trabalho (uma codificação a menos e uma decodificação a menos por quadro).
- O atraso medido é **da mesa até a saída para a internet**. O atraso que o público vê continua dependendo da plataforma e do modo de latência escolhido nela.
- Compensação de ±120 ms pelo motor novo: medições finais de +95 ms e −147 ms no arquivo (precisão de um quadro, cerca de 33 ms).

## Testes
- **75 automáticos do serviço** (eram 70) e 8 verificações de interface:
  - empacotador Matroska: o FFmpeg lê a saída própria com os mesmos quadros e quadros-chave nos mesmos instantes; um arquivo cortado em qualquer ponto ainda abre; após reinício o vídeo só volta em quadro-chave;
  - serviço: argumentos do motor novo (vídeo copiado, sem filtros de atraso duplicados), gravação com **vídeo idêntico ao enviado** (diferença de tamanho de H.264 abaixo de 8%, só o contêiner muda) e som AAC, e a **troca para o padrão no meio da sessão** com duas partes gravadas.
- **Navegador real (Chromium) com o serviço real:** 16:9 + 9:16 ao mesmo tempo (1280×720 e 720×1280, H.264 + AAC); FFmpeg morto durante a gravação (duas partes); codificador do navegador falhando de propósito (passa ao padrão, duas partes); calibração de sincronismo pelo motor novo (15 s, 8 pares).

## O que **não** foi testado (confira no primeiro ensaio de produção)
- **Windows com placa de vídeo real.** O ambiente de teste só oferece H.264 por software e não tem AAC no navegador (por isso o som segue como Opus até o FFmpeg). No seu computador o cartão "Este computador" mostra se o H.264 usa a placa de vídeo. Se a placa recusar a configuração, a mesa usa o padrão sozinha.
- **Qualidade visual por bitrate** entre o H.264 do navegador e o x264 do motor padrão: não foi comparada. Se preferir o x264, escolha *Padrão* no seletor.
- Transmissão longa (horas) com o motor novo.

Primeiro ensaio sugerido: abra **Este computador**, confira a linha do motor; faça **Calibrar** de sincronismo; transmita 30 minutos para um destino "não listado" olhando os quadros descartados e a saúde na plataforma.
