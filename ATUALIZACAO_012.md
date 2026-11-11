# Andrômeda Live 0.12 — produção: multiplataforma, gravação, mosaico e auditoria

Esta versão tira da mesa o que era demonstração e liga o que faltava para uma live real: vários destinos ao mesmo tempo, gravação em disco, mosaico de câmeras, identidade visual da marca e registro de tudo o que acontece.

## Mesa

- **Layout novo.** Preview à esquerda e PGM à direita no topo, câmeras logo abaixo, e a faixa de corte (CUT, AUTO, tipo de transição, duração e T-bar horizontal) sempre presa à base da janela. Quem já tinha um layout salvo recebe o novo padrão; "Personalizar" continua disponível.
- **Identidade Andrômeda Live.** Paleta (#00A3FF, #8B00FF, #FF0033, #0B0F2A, #E6E8F2), Exo 2 nos títulos e Montserrat nos textos, ícone da marca. Vermelho continua reservado ao PGM e verde ao Preview.
- **Só sinal real.** Canal sem fonte aparece como "SEM SINAL". As fotos de demonstração deixaram de ser o padrão; existe "Imagem de teste" por canal para ensaio, identificada como tal. O contador do cabeçalho mostra câmeras com sinal.
- **Quantidade de monitores.** No painel Câmeras, escolha de 1 a 10 monitores. Os canais seguem sempre a ordem CAM 1 a CAM N e o próximo convite já aponta para o primeiro canal livre.
- **16:9 e 9:16.** Fonte vertical entra inteira, com o fundo preenchido pela própria imagem desfocada. Em "Fontes de câmera" dá para forçar preencher ou imagem inteira por canal.
- **Mosaico.** Marque câmeras com o botão **M** (ou "Mosaico: todas com sinal") e leve a fonte **MOSAICO** ao Preview/PGM (tecla M). A mesa distribui as câmeras sozinha conforme a quantidade e o formato de cada uma, sem cortar fontes verticais; as células deslizam quando uma câmera entra ou sai. Tally de "no ar" e áudio AFV valem para todas as câmeras do mosaico. Nomes no mosaico são opcionais.

## Transmissão multiplataforma

Página **Transmissão → Destinos**. Até 6 destinos simultâneos: YouTube, Facebook, Instagram, Twitch, Kick, TikTok, LinkedIn ou qualquer servidor RTMP/RTMPS. Para cada um, cole a URL do servidor e a chave copiadas da plataforma.

- O computador codifica **uma vez** (H.264 + AAC) e distribui para todos. Reserve upload de cerca de bitrate × destinos × 1,3.
- Cada destino tem fila própria: se uma plataforma cair, ela aparece como RECONECTANDO e volta sozinha, sem derrubar as outras nem a gravação.
- As chaves ficam só na memória. "Lembrar chaves neste computador" guarda no navegador deste computador, por escolha do operador.
- Instagram e TikTok exibem em vertical: o quadro 16:9 aparece com faixas. Saída vertical dedicada ainda não existe.
- Codificador: processador (x264) por padrão. Se o FFmpeg detectar placa NVIDIA, Intel Quick Sync ou AMD, a opção aparece na lista; ela precisa ser validada no computador de produção antes de uma live.

## Gravação

- Ligue "Gravar junto com a transmissão" (ou use só a gravação, sem destinos).
- A mesa lista as unidades do computador com espaço livre, incluindo HD/SSD externo e pendrive assim que são conectados. Escolha a unidade ou digite a pasta; "Verificar pasta" testa a escrita e calcula quantas horas cabem.
- O arquivo é gravado em MKV durante a live (resiste a queda de energia) e convertido para **MP4** ao parar, sem recodificar.
- A gravação começa e termina junto com o envio. Aviso quando restarem menos de 2 GB.
- Nuvem: escolha como pasta de gravação a pasta sincronizada do Google Drive para computador (ou OneDrive); o envio acontece depois da live. Upload direto pela conta Google está avaliado em `AVALIACAO_PRODUTO.md`.

## Diagnóstico e auditoria

- Cada sessão do serviço grava `logs/andromeda-AAAA-MM-DDTHH-MM-SS.jsonl`: início e fim de envio, destinos reconectando, falhas do codificador, câmeras e mesa conectando ou saindo, convites, gravações, cortes e seleções do operador, erros da página, queda de rede, aba oculta durante o envio e queda de quadros por segundo.
- Página **Diagnóstico**: estado do serviço, contadores, lista filtrável e "Exportar auditoria". A aba mostra um contador quando há avisos novos.
- Chaves de transmissão e chaves de convite nunca são gravadas. Ficam os 30 arquivos mais recentes.

## Licença por assinatura (base pronta, desligada)

O programa já confere tokens de ativação assinados, com plano e validade. Enquanto não houver `license-public.pem` na pasta, o licenciamento fica desligado: é o modo desta fase de testes. Quando for vender:

```
node tools/licenca.cjs chaves
node tools/licenca.cjs emitir --plano anual --cliente "Nome do cliente" --email cliente@exemplo.com
```

O primeiro comando cria a chave privada (fica só com o vendedor, nunca no GitHub) e a pública (vai com o programa). O segundo imprime o token que o cliente cola em Diagnóstico → Licença. Planos: teste (14 dias), mensal (31), anual (366). Aviso nos últimos 7 dias, tolerância de 3 dias após o vencimento e, depois disso, a transmissão é bloqueada.

## Validação

Executado nesta revisão:

- `npm test`: 37 de 37, incluindo um envio real para dois servidores RTMP locais (um deles fora do ar) com gravação em MP4 e conferência da trilha de auditoria.
- Navegador (Chromium, câmeras simuladas): canais sem demonstração, quatro fontes, 4 monitores, mosaico no ar com tally e AFV, envio para dois destinos mais gravação, parada, diagnóstico. Sem erros de página.

Não validado, e obrigatório antes da primeira live real:

- Envio para as plataformas reais com as chaves de cada conta (YouTube, Facebook, Instagram, Twitch, Kick, TikTok, LinkedIn).
- Windows no computador de produção, live longa (2 horas ou mais), uso de CPU e upload com vários destinos.
- Codificador por GPU, gravação em HD externo real e listagem de unidades no Windows.
- Celulares reais em 4G/5G, áudio, intercom e TURN.
