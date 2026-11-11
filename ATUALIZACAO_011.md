# Andromeda Live 0.11 — revisão geral e nova interface

Revisão completa do pacote 0.10 (mesa) e do cliente de câmera por convite, com correções de funcionamento e redesenho da interface. A lógica de sinalização, WebRTC, recepção Blackmagic e codificação para o YouTube não mudou de protocolo.

## Correções de funcionamento

- **Monitores congelados (0.10).** A personalização da mesa removia da página o monitor de key do PiP; a rotina de desenho falhava no primeiro quadro e parava. Multiview, Preview, PGM e a prévia de efeitos ficavam com a imagem parada. O monitor de key agora fica no painel "Camadas no ar" e a rotina não depende mais dele.
- **Moldura de tally invisível no celular.** A borda vermelha de "no ar" era desenhada atrás do vídeo. Agora é uma camada própria, acima de tudo: vermelha no PGM, verde no Preview.
- **Convite colado quebrava.** Colar só a chave (sem o link) gerava erro silencioso. O campo aceita o link completo ou a chave e explica o que está errado.
- **Mensagens de erro da câmera.** Convite recusado, falta de rede, permissão negada, câmera em uso por outro app e lente indisponível tinham todas o mesmo texto ("não foi possível capturar"). Cada caso tem a sua mensagem.
- **Troca de lente.** Se a nova lente não abrir, o cliente volta para a anterior em vez de ficar sem imagem.
- **Imagem coberta por controles.** Em paisagem, o painel lateral cobria a borda direita do quadro. O vídeo agora ocupa só a área livre.
- **Versão do serviço.** `/api/session` informava 0.9.0 fixo; agora lê o `package.json`.

## Andromeda Cam (celular)

- Visor limpo: tally no topo, controles em trilho lateral (paisagem) ou na base (retrato), nada sobre o centro do quadro.
- Tela de entrada com o estado do convite e três passos (fones, permissões, celular na horizontal), em vez de abrir uma caixa de configuração.
- Botão único: disco vermelho para ativar, quadrado para parar.
- Lentes físicas como botões (Principal, Ultra-wide, Tele, Frontal) quando o navegador expõe mais de uma câmera. Não há zoom digital.
- Telemetria legível ao sol: resolução e fps reais, bitrate de envio, qualidade do enlace (latência e perda), rede e bateria.
- Avisos informativos somem do visor depois de alguns segundos; alertas ficam.
- Grade de terços alinhada à área real da imagem; lembrete para girar o celular; aviso "Intercom aberto · microfone do programa mudo" enquanto fala com o DTV; vibração ao entrar no ar (Android).
- Tela cheia ao ativar (onde o navegador permite) e reaquisição do bloqueio de tela ao voltar para o app.
- Fontes do sistema e nenhum recurso externo: a página carrega igual em 4G/5G e respeita a política de segurança do gateway.
- `docs/` (GitHub Pages) e `public/cam/` (servido pelo gateway) são os mesmos arquivos; só `config.js` muda. Um teste falha se as cópias divergirem.

## Mesa

- Cabeçalho único e fixo com marca, abas e estado da transmissão; barra de estado fixa na base com a última ação e os atalhos.
- Operação mais densa: medidor L/R do PGM em faixa compacta, CUT/AUTO grandes com o atalho escrito no botão, T-bar ao lado. Em 1440×900 câmeras, PGM, Preview e corte aparecem sem rolar.
- Miniaturas: nome e etiqueta PGM/PRV no topo, seletor de áudio embaixo (antes o seletor cobria o nome).
- Barramentos com teclas acesas: verde cheio no Preview, vermelho cheio no PGM.
- Convites em três passos com **QR code** gerado no próprio computador: endereço público, câmera e qualidade, enviar ao celular (copiar, compartilhar, WhatsApp).
- Configurações: convites primeiro; "Personalizar a mesa" recolhido até ser pedido; ações soltas reunidas em uma barra por página.
- Um único sistema visual (`public/andromeda-ui.css`): vermelho só para PGM, verde só para Preview, âmbar para transição, azul para foco e ação principal.
- Sem rolagem horizontal de 390 px a 1920 px.

## Estrutura

```
andromeda-live/
  server.cjs, camera-hub.cjs, cloud-server.cjs …   serviço da mesa e gateway
  public/                                          mesa (localhost:3180)
  public/cam/                                      câmera servida pelo gateway
  docs/                                            a mesma câmera para GitHub Pages
  cloud/                                           gateway público (Docker + Caddy + TURN)
  test/                                            testes automatizados
andromeda-cam-mobile/                              projeto nativo Flutter (experimental, não alterado)
```

## Publicar a página da câmera

Copie `docs/index.html`, `cam.css`, `cam.js`, `manifest.json` e `icon.svg` para a pasta `docs/` do repositório que já publica a câmera (`config.js` é gerado pelo workflow de lá e não deve ser copiado). Para publicar a partir deste repositório, ative Settings → Pages → GitHub Actions e execute o workflow "Publish Andromeda Cam".

## Validação

Executado nesta revisão:

- `npm test`: 28 de 28 com o FFmpeg instalado pelo pacote (`ffmpeg-static`). Com um FFmpeg 6.1 do sistema à frente no PATH, o teste de ponte do YouTube falha por tempo: essa versão só informa progresso enquanto chegam dados, e o teste envia 2 segundos e espera. Em transmissão contínua o progresso continua chegando.
- `test/workspace-ui.cjs` (jsdom): passa.
- Ponta a ponta em Chromium com câmera simulada e gateway atrás de HTTPS local: a mesa gera o convite, o QR decodifica para o mesmo link, o "celular" abre, o vídeo chega à miniatura da mesa, o tally mostra PREVIEW, CUT leva a NO AR, revogar encerra a câmera.
- Capturas de tela da câmera em retrato e paisagem e da mesa em seis tamanhos de janela.

Não validado: aparelhos físicos (iPhone/Android), Safari, rede 4G/5G real, TURN em produção, publicação em um canal real do YouTube, áudio e intercom com fones. Esses itens continuam sendo homologação obrigatória antes de uma produção.
