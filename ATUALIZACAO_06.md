# Andromeda Live 0.6 + Andromeda Cam

Esta entrega é um pacote de desenvolvimento e teste. A mesa e o cliente web têm implementação de captura/transporte real; o app Flutter usa captura nativa por flutter_webrtc, mas ainda não foi compilado, assinado ou validado em aparelhos. Não inclui APK/IPA nem servidor público contratado. Não substitua uma transmissão de produção antes de testar tudo com os seus equipamentos.

## Começar no Windows

1. Feche o servidor anterior. Extraia este ZIP em uma pasta nova, preservando a instalação antiga.
2. Em Andromeda_Live_YouTube, execute INSTALAR.bat e depois INICIAR.bat. Requer Node.js 22 e internet na instalação. Mantenha o terminal aberto.
3. Abra http://localhost:3180 e atualize com Ctrl+F5. VERIFICAR.bat verifica o ambiente; npm test executa os testes automatizados.
4. Leia abaixo para parear o telefone. A câmera não está transmitindo apenas porque aparece uma imagem demonstrativa na mesa. A fonte recebida passa a exibir ANDROMEDA CAM · WEBRTC; confira movimento real e identificação.

## Organização da mesa

- Operação: miniaturas das câmeras à esquerda; Preview e AR à direita, controles de corte abaixo deles. Em telas estreitas os blocos se empilham.
- Clique na câmera para selecionar o Preview. Espaço executa CUT para o AR, exceto ao digitar em campos/formulários. AUTO mantém os efeitos de transição existentes.
- Transmissão: configurações e comandos de envio ao YouTube. O envio precisa ser iniciado pelo operador, com URL/chave reais.
- Configurações: conexão Blackmagic, pareamento Andromeda Cam e parâmetros da mesa.
- GC e efeitos: preparação das sobreposições. A transmissão captura exclusivamente a composição PROGRAM: imagem do AR e suas camadas ativas. O Preview e a interface não entram na saída.

## GC, logotipo e DVE/PiP

1. Abra GC e efeitos. Escolha uma das três camadas: Créditos, Chamada ou Legenda.
2. Preencha título e subtítulo. Escolha canto, largura, tamanho de texto, cores e opacidade do fundo. Textos longos são limitados a duas linhas por campo; revise a prévia para evitar truncamento.
3. Para preparar sem exibir, deixe “Ativar esta camada ao aplicar” desmarcado e clique Aplicar ajustes ao programa. Na Operação, use o botão daquela camada para colocá-la e retirá-la do AR.
4. Para trocar um crédito que já está no AR, edite o rascunho e clique Aplicar quando estiver pronto. Aplicar também transfere todos os estados de ativação marcados no rascunho: confira-os antes. Descartar restaura o rascunho a partir do estado atual do AR.
5. Logotipo: carregue PNG, JPEG ou WebP local de até 10 MB / 8192 pixels por lado. PNG/WebP podem preservar transparência. Escolha tamanho, canto e opacidade; aplique. O botão Logotipo na operação liga/desliga.
6. PiP: escolha a câmera secundária, um dos quatro cantos, largura de 15% a 50%, borda e enquadramento inteiro ou recortado. Aplique e use o botão PiP para colocar/retirar a janela. O áudio é definido no mixer, independentemente do PiP.
7. A composição é, de baixo para cima: imagem principal, PiP, camadas de GC e logotipo. “Mover para trás/frente” reorganiza os GCs entre si. Camadas no mesmo canto podem se sobrepor.
8. “Retirar todas” remove somente as sobreposições do AR. Não corta a câmera nem encerra a transmissão.

Os efeitos são mantidos nesta sessão do navegador, não em um arquivo de projeto. Ao recarregar, reinsira textos e logo. Não há animações de entrada, teleprompter, legendagem automática ou editor livre de coordenadas nesta versão. O DVE entregue é redimensionamento e posicionamento PiP nos quatro cantos.

## Áudio e intercom

Ative “Ativar áudio / medidores”. Cada fonte tem OFF (sem áudio), AFV (acompanha o corte) e ON (permanece no master mesmo fora do AR), além de volume e medidor. Para vídeo com trilha contínua, escolha ON; para microfone da câmera acompanhando o corte, AFV. O medidor representa o áudio destinado ao master. “Ouvir em fones” habilita monitoração local.

O intercom usa uma conexão de áudio separada, fora do mixer da transmissão. No computador, conecte fones, habilite o intercom, escolha uma câmera ou todas e segure FALAR. No telefone, segure FALAR DTV. Durante o PTT do telefone o microfone de programa é silenciado para não levar a conversa ao AR. Isso não substitui isolamento acústico: use fones em ambos os lados. Seleção/roteamento de microfones USB, Lightning, Bluetooth e P2 depende do hardware e sistema; deve ser verificada no aparelho. Bluetooth pode reduzir qualidade ou mudar a rota de áudio.

O tally vermelho indica que a mesa selecionou a câmera em PROGRAM. Não comprova que a live está pública no YouTube. Perda de sinalização invalida o tally, em vez de manter uma indicação antiga de AR.

## Andromeda Cam por Wi-Fi e 4G/5G: configuração inicial privada

O caminho preparado usa WebRTC e um gateway HTTPS privado. Funciona sobre redes IP, mas atravessar redes celulares depende de ICE, firewall e disponibilidade de relay. O IP 192.168.x.x isoladamente não permite chegar à mesa pela internet.

1. Instale Tailscale no computador e no celular: https://tailscale.com/download. Conecte ambos à mesma rede privada autorizada. Confira o plano apropriado ao uso comercial; nenhum serviço pago foi contratado neste pacote.
2. Com INICIAR.bat aberto, o gateway da câmera escuta somente em 127.0.0.1:3185. A mesa de operação continua em localhost:3180.
3. No terminal do computador execute: `tailscale serve --bg http://127.0.0.1:3185`. Siga a autorização HTTPS solicitada pelo Tailscale e copie a origem HTTPS exibida, como https://nome-do-pc.sua-rede.ts.net. Não use Funnel e não publique o painel de operação.
4. Na mesa, Configurações > Andromeda Cam, informe essa origem HTTPS e salve. Gere um convite para um canal e nome. Copie o link completo para o próprio telefone. O convite dá acesso à câmera daquele canal: não publique o link.
5. Primeiro teste pelo navegador do telefone, abrindo o link: permita câmera/microfone e toque Conectar. Para o projeto nativo, compile conforme a pasta Andromeda_Cam_Mobile e cole o mesmo convite no aplicativo.
6. Comece com duas câmeras, 720p, 30 fps e cerca de 2–3 Mbps por câmera. A capacidade total depende de CPU/GPU, Wi-Fi, upload e decodificação; não foi certificada uma quantidade simultânea.
7. Na mesa, aguarde VÍDEO RECEBIDO e confira movimento. Escolha o áudio, selecione Preview e faça CUT. Teste o tally e as duas direções do intercom antes de iniciar YouTube.
8. Para testar rede celular, mantenha Tailscale conectado e desligue o Wi-Fi do telefone. Confirme que ambos os apps têm permissão para dados móveis. Mantenha a mesa ligada e online.
9. Convites expiram em 12 horas e são apagados ao reiniciar o serviço. Gere outro quando necessário. Revogar encerra o acesso daquele canal. Um novo convite substitui o anterior.

Há nove slots possíveis para Andromeda Cam, reservando BM CAM para uma entrada RTMP. A configuração inicial mostra oito fontes no total; aumente o limite da mesa para dez para expor todos os slots. Esta é uma capacidade de endereçamento, não uma garantia de desempenho.

### Se parear mas não chegar vídeo

HTTPS/WSS transporta o pareamento; a mídia WebRTC negocia caminhos próprios. VPN conectada não garante que o navegador anuncie candidatos utilizáveis. Se não houver caminho ICE direto, configure um servidor TURN acessível aos dois dispositivos. O pacote não inclui um TURN implantado nem credenciais públicas de terceiros.

O serviço aceita ANDROMEDA_ICE_SERVERS como array JSON de RTCIceServer. Exemplo de PowerShell, substituindo host e credenciais por um TURN real administrado pela equipe:

```powershell
$env:ANDROMEDA_ICE_SERVERS='[{"urls":["turns:turn.seudominio.com:5349?transport=tcp"],"username":"USUARIO_TEMPORARIO","credential":"SENHA_TEMPORARIA"}]'
node server.cjs
```

Configure domínio/certificado, autenticação, faixas de portas e relay no servidor TURN conforme a implementação escolhida. Credenciais ICE são entregues aos participantes autenticados da sessão; use credenciais temporárias, limite de tráfego e revogação. Nunca use um relay aberto. Um administrador precisa implantar essa infraestrutura se a rede privada não bastar. Não abra portas aleatórias nem desative o firewall para tentar corrigir a conexão.

## Escopo do aplicativo nativo

A pasta Andromeda_Cam_Mobile contém código Flutter com captura nativa via WebRTC, UI, pareamento, tally, PTT, seleção de dispositivos e canais Swift/Kotlin para informações do hardware. Flutter é a camada de interface; não são dois apps independentes escritos inteiramente em Swift e Kotlin.

- Solicita 720p/1080p/4K e 24/30/60 fps; disponibilidade e resultado dependem do capturador e aparelho. Confira a resolução efetiva, não apenas o valor escolhido.
- Seleciona somente lentes físicas enumeradas e acessíveis. Não presume 2x/10x como lente real. Mantém zoom em 1 no dispositivo selecionado e não oferece zoom digital. A troca pode causar interrupção breve.
- Android pode ocultar lentes físicas de terceiros ou expor apenas câmera lógica; nesse caso a captura física solicitada pode ser indisponível. Não existe promessa de equivalência com a câmera original do fabricante.
- Foco/exposição por toque usam APIs do capturador. Controles manuais iOS são código experimental; ISO/balanço de branco Android e seleção manual OIS/EIS não foram implementados. Estabilização depende do capturador.
- Bateria e estado térmico vêm do sistema quando disponíveis; Android pode informar temperatura da bateria, não do sensor da câmera. iOS não oferece temperatura absoluta nesse canal.
- Não há bonding simultâneo Wi-Fi + celular, SRT, gravação local ou garantia de continuidade ao mudar de rede. Há tentativa de reconexão de sinalização. Captura em segundo plano não é suportada.

O cliente web /cam é uma opção de teste imediato após HTTPS. Suas permissões, lentes e controles são mais limitados pelo navegador; ele não deve ser apresentado como APK/IPA.

## Validação desta entrega

16 testes automatizados passaram: autorização e transporte local, conversão real FFmpeg, entrada RTMP real de vídeo/áudio, endereçamento/preset, convites/revogação/tally/sinalização e composição GC/PiP. Um teste DOM com APIs de mídia simuladas verificou carregamento dos scripts, organização dos elementos, rascunho/aplicação/remoção de GC, origem PROGRAM e CUT por Espaço.

Não foram feitos compilação Flutter completa, instalação em celular, teste WebRTC entre aparelhos, inspeção visual em navegador gráfico, ensaio 5G, validação de sincronismo/latência nem publicação real no YouTube. Os testes de backend não comprovam esses itens. Faça uma transmissão não listada com seus aparelhos antes de produção.

## Referências técnicas e de produto

- LU-Smart: https://www.liveu.tv/products/create/lu-smart e https://www.liveu.tv/lu-smart-qsg
- TVU Anywhere: https://www.tvunetworks.com/products/tvu-anywhere/
- Flutter WebRTC: https://pub.dev/packages/flutter_webrtc
- Apple AVCaptureDevice: https://developer.apple.com/documentation/avfoundation/avcapturedevice
- Android multicâmera: https://developer.android.com/media/camera/camera2/multi-camera
- Tailscale Serve: https://tailscale.com/docs/features/tailscale-serve

As referências orientam captura, retorno e tally. Não há licença, integração com protocolos proprietários ou equivalência de redundância/bonding com LU-Smart/TVU. A tabela anterior de lentes fornecida na conversa não deve ser usada: iPhone 15 Pro tem tele 3x; 15 Pro Max tem 5x; opções “qualidade óptica” podem ser recortes do sensor. A implementação consulta o aparelho em vez de tabelas comerciais.
