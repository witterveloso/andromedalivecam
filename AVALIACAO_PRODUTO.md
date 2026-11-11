# Andrômeda Live — avaliações e próximos passos

Respostas às perguntas de produto levantadas na revisão 0.12, com o que já entrou no código e o que fica como etapa seguinte. Onde algo não pôde ser testado aqui, está dito.

## 1. Formato: local no navegador ou programa instalado?

**Hoje.** Um serviço local (Node.js) abre a mesa no Chrome em `localhost:3180`. Funciona, mas tem três limites para produção:

1. **Duas codificações.** O navegador comprime o PROGRAM em VP8 e o FFmpeg descomprime e recomprime em H.264. É o maior custo de CPU da cadeia.
2. **É uma aba.** Se ela ficar oculta ou minimizada, o Chrome reduz os quadros. Atualização de navegador pode mudar comportamento na véspera de uma live.
3. **Instalação manual.** Depende de Node, `INSTALAR.bat` e de o operador manter uma janela de terminal aberta.

**Recomendação: programa instalado no computador (aplicativo de desktop), com o mesmo código da mesa.** O caminho de menor risco é empacotar com Electron e um instalador para Windows:

- embute Node, FFmpeg e a mesa: um instalador, um ícone, sem terminal;
- janela própria sem redução de quadros em segundo plano;
- atualização automática e versão do motor de vídeo fixada por nós;
- chaves de transmissão e licença no cofre do Windows, em vez do armazenamento do navegador;
- base natural para o licenciamento por assinatura.

Uma versão "na nuvem" não serve para a mesa: o corte precisa de latência de quadros e o vídeo de dez câmeras teria de subir antes de ser misturado. A nuvem continua sendo o lugar do gateway das câmeras e, depois, do servidor de licenças.

**Desempenho, em ordem de ganho:**

| Etapa | O que muda | Estado |
| --- | --- | --- |
| Uma codificação para todos os destinos e a gravação | FFmpeg `tee` com fila por destino | Feito na 0.12 |
| Codificação por placa de vídeo no FFmpeg | NVENC, Quick Sync, AMF detectados por teste | Código pronto, opcional; falta validar em hardware real |
| Eliminar a codificação dupla | O aplicativo codifica H.264 pela GPU (WebCodecs) e o FFmpeg só distribui (`-c copy`) | Próxima etapa, junto com o aplicativo |
| Compositor em WebGL | Mistura, mosaico e efeitos na GPU, base para efeitos 3D | Depois do aplicativo |

Computador recomendado para 1080p com vários destinos: processador de 8 núcleos recente, 16 GB de memória, placa de vídeo dedicada, SSD e upload estável de bitrate × destinos × 1,3. Esses números são estimativa de projeto; a medição real precisa ser feita no equipamento de produção.

O empacotamento não foi feito nesta revisão: exige montar e testar o instalador em Windows.

## 2. Referências do StreamYard

Usado como referência de funções, não de aparência. Fontes: [visão geral da plataforma](https://streamyard.com/blog/all-in-one-streaming-and-branding-platform), [transmissão e gravação](https://streamyard.com/blog/all-in-one-live-streaming-and-recording-platform), [comparativo 2026](https://streamyard.com/blog/streaming-software-2026-comparison), [tutorial](https://primalvideo.com/?p=2111246).

| Função de referência | No Andrômeda Live |
| --- | --- |
| Transmitir para vários destinos e RTMP próprio | Feito: até 6 destinos, com reconexão por destino |
| Layouts que se ajustam ao número de participantes | Feito como Mosaico, com a diferença de respeitar fontes 16:9 e 9:16 na mesma tela |
| Convidado entra por link | Feito: convite com QR code e tally no celular |
| Nome do participante na tela | Feito no mosaico (opcional); GC já cobre créditos, chamada e legenda |
| Logo, sobreposições e janela (PiP) | Já existiam; continuam |
| Gravação local | Feito para o PROGRAM em MP4 |
| Tema de marca único (cores e fonte dos GCs) | Próximo: hoje cada GC tem as suas cores |
| Faixa de texto rolante (ticker) | Próximo |
| Estilos de layout (destaque, lado a lado, tela + câmera) e layouts salvos | Próximo: o mosaico hoje escolhe sozinho |
| Fundo personalizado do mosaico e vinhetas de vídeo | Próximo |
| Compartilhar tela ou slides como fonte | Próximo e simples: o navegador já captura tela |
| Comentários das plataformas na tela | Depende de integração com a API de cada plataforma |
| Criar e agendar a live pela mesa (título, capa) | Depende de login OAuth em cada plataforma |
| Gravação separada por câmera (ISO) | Próximo, depois do aplicativo instalado |

## 3. Plugins do OBS enviados

Os cinco anexos são instaladores para Windows de plugins do OBS Studio (código nativo e shaders). Eles não podem ser carregados pela mesa, que desenha em canvas no navegador, e não foram executados. O que se aproveita é a ideia de cada um. Referências: [recursos do autor Exeldro](https://obsproject.com/forum/resources/authors/exeldro.128836/), [plugins suportados pela Elgato](https://docs.elgato.com/obs/scene-collections/supported-obs-plugins).

| Plugin | O que faz no OBS | No Andrômeda Live |
| --- | --- | --- |
| Move Transition | Anima posição e tamanho das fontes entre cenas | Aplicado no mosaico: as células deslizam para o novo lugar. Próximo: transição "mover" entre Preview e PGM e animação do PiP |
| Source Clone | Duplica uma fonte para tratá-la de outro jeito | A mesa já usa a mesma câmera em PGM, PiP e mosaico ao mesmo tempo |
| Stroke Glow Shadow | Contorno, brilho e sombra em fontes recortadas | Mosaico já tem borda e sombra; PiP tem borda. Próximo: brilho e sombra ajustáveis |
| Advanced Masks | Recorta a fonte por forma, imagem ou degradê | Mosaico usa cantos arredondados. Próximo: PiP redondo ou arredondado e borda suave |
| 3D Effect | Rotação e perspectiva 3D da fonte | Não cabe no canvas 2D atual. Entra com o compositor em WebGL |

## 4. Gravação em HD externo e no Google Drive

- **Computador e HD externo: feito.** A mesa lista as unidades com espaço livre, reconhece unidades removíveis quando conectadas, testa a escrita e calcula as horas disponíveis. A listagem no Windows usa PowerShell e não pôde ser executada neste ambiente (Linux); a lógica de pasta, espaço e gravação foi testada.
- **Gravar direto no Google Drive: não recomendado.** O Drive não é um disco para escrita contínua: seria um upload ao vivo disputando banda com a transmissão, e uma queda de rede no meio pode custar o arquivo. O caminho seguro é gravar no disco e enviar ao terminar.
- **Disponível hoje, sem código novo:** instalar o Google Drive para computador e escolher a pasta sincronizada como pasta de gravação. O arquivo sobe sozinho depois da live.
- **Envio pela conta Google dentro do programa (próximo):** login de aplicativo instalado (OAuth com PKCE), permissão `drive.file` (o programa só enxerga os arquivos que ele mesmo criou) e upload retomável, que continua de onde parou se a rede cair. Precisa de um projeto no Google Cloud em nome da Andrômeda, com a tela de consentimento verificada. Não foi implementado porque depende dessa credencial.

## 5. Câmera do celular com os recursos do aparelho

A página web usa o que o navegador entrega: lentes como câmeras separadas, foco, exposição, balanço de branco e lanterna quando o aparelho expõe. O navegador **não** dá acesso a estabilização óptica ou eletrônica, não garante a escolha de cada lente, não mantém a câmera com o app em segundo plano e limita formatos (4K60, HDR).

Para qualidade de instrumento profissional é preciso o **aplicativo nativo**:

- **iPhone:** lentes ultra-wide, principal e tele pelos pontos ópticos (sem zoom digital), estabilização cinematográfica, formatos 4K e 60 fps, foco, ISO, obturador e balanço de branco manuais.
- **Android:** lentes físicas pela API de câmera, estabilização de vídeo e OIS, controles manuais conforme o aparelho.
- Transporte: manter WebRTC, que já conversa com a mesa, e acrescentar SRT para rede móvel instável.

O projeto `andromeda-cam-mobile/` (Flutter) é o ponto de partida, mas é experimental: nunca foi compilado nem testado em aparelho. Compilar, assinar e homologar exige Android Studio, um Mac com Xcode e celulares reais, o que não é possível neste ambiente. É a maior pendência do produto.

## 6. Licenciamento por assinatura

**Na 0.12:** token de ativação assinado (Ed25519) com plano, cliente e validade; conferência dentro do programa; aviso nos 7 dias finais, tolerância de 3 dias e bloqueio da transmissão depois disso; gerador de chaves e de tokens em `tools/licenca.cjs`. Fica desligado até existir a chave pública na pasta do programa.

**Fluxo de venda sugerido:** pagamento confirmado na plataforma de cobrança → o servidor chama a mesma função de emissão → o token segue por e-mail → o cliente cola em Diagnóstico → Licença. Renovação é um token novo.

**Limites do token offline, para decidir antes de vender:**

- pode ser copiado para outro computador;
- não dá para cancelar antes do vencimento (um reembolso, por exemplo).

A segunda etapa resolve os dois: ativação online, que vincula o token ao computador, limita a quantidade de máquinas e permite revogar. Pode usar o Supabase que o projeto já tem. A chave privada de assinatura deve ficar fora do GitHub, com cópia de segurança: perdê-la invalida a emissão de novos tokens.

## 7. O que falta para uma produção real

O código desta versão foi testado em ambiente de desenvolvimento, com câmeras simuladas e servidores RTMP locais. Antes de uma live com público:

1. Rodar no computador de produção (Windows) e fazer uma live privada em cada plataforma, com as chaves reais.
2. Live de ensaio de 2 horas com todos os destinos e a gravação ligados, olhando a página Diagnóstico ao final.
3. Medir o upload do local e ajustar bitrate e número de destinos.
4. Testar os celulares reais em Wi-Fi e em 4G/5G, com fones, intercom e tally.
5. Gravar em HD externo e conferir o MP4.
6. Só então ligar o codificador por GPU, se o teste no equipamento for estável.
