# Andrômeda Live 0.21 — Motor Andrômeda: nossa própria tecnologia de transmissão

## 0.21.1
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
