# Andrômeda Live 0.30 — Andrômeda Cam como câmera de transmissão

## 0.30.1 — tela no ar limpa
- **Só o que importa no ar.** Com a câmera ativa, depois de 8 s sem tocar na tela:
  - somem o botão "Ouvir microfone nos fones", o lembrete de girar o celular e os avisos informativos;
  - os instrumentos (resolução, envio, bateria) ficam discretos;
  - ficam a imagem, o tally, a barra de ajustes, o medidor de áudio e o timecode.
- **Um toque traz tudo de volta.** Qualquer toque na tela mostra os controles de novo.
- **Alertas nunca somem.** Alertas e erros continuam sempre visíveis. Com a gaveta de ajustes ou os Ajustes abertos, a tela não se esconde.
- **Testes.**
  - Teste automático novo em `test/cam-broadcast.test.cjs`.
  - Conferido num celular simulado, em retrato e paisagem: a tela fica limpa depois de 9 s e tudo volta com um toque.

## 0.30.0 — auditoria completa do Andrômeda Cam e visual broadcast

### Engenharia (auditoria)
- **Áudio de programa limpo.** O celular mandava o som com cancelamento de eco e supressão de ruído ligados.
  - Esses filtros "bombeiam" o som, abafam música e cortam o ambiente.
  - Agora o áudio vai como num equipamento de transmissão: sem cancelamento de eco, sem supressão de ruído e sem ganho automático, em estéreo e 48 kHz.
  - Para quem estiver sem fones, existe a opção **Ajustes → Áudio → Celular sem fones**, que religa só o cancelamento de eco.
- **Áudio em qualidade de transmissão.** Antes o celular mandava ~24 kb/s, um padrão pensado para chamada de voz. Agora manda **128 kb/s**, em estéreo e com correção de perdas, combinado entre celular e mesa.
  - Medido com a mesa real recebendo de um convite: 24 kb/s antes, 128 kb/s depois.
- **Troca de antena ou de rede sem derrubar a câmera.** Uma queda passageira da conexão (trocar de antena, passar do Wi-Fi para o 5G) refazia toda a conexão depois de 2 s, mesmo quando ela voltaria sozinha. Agora:
  - na queda passageira, a câmera espera até 6 s pela recuperação;
  - na falha de verdade, a conexão é refeita em 1 s.
- **Telemetria de envio.** O app passa a mostrar o que realmente sai para a mesa: **ENVIO 1920×1080 · 30 q/s**.
  - Quando algo segura a imagem, mostra o motivo: **limite: rede** ou **limite: processador**.
  - A cor indica a situação: verde 28 q/s ou mais; amarelo de 24 a 27; vermelho abaixo disso.

### Visual broadcast (crítica de design de UX/UI aplicada)
- **Tally como luz de câmera de estúdio.** Faixa colorida no topo da tela, moldura e placa grande:
  - vermelho, **NO AR**;
  - verde, **PREVIEW**;
  - âmbar, em espera.
- **Medidor de áudio em dBFS.**
  - Faixa de −60 a 0, em segmentos, com as cores fixas no lugar: verde até −18, amarelo até −6, vermelho acima.
  - Marca de pico que segura 1,5 s e aviso **CLIP** quando o som encosta em 0 dBFS.
- **Timecode HH:MM:SS** em fonte de instrumento; fica vermelho quando a câmera está no ar.
- **Grade com áreas de segurança.** Terços, área de título (90%) e de ação (93%) e cruz central.
- **HUD de instrumento.** Chips retos em fonte de número e caixa alta; nome da câmera em destaque; fundo preto puro durante a operação.
- **Correção.** Com o celular na horizontal, o rótulo "CONECTAR" ficava cortado dentro do botão. Agora cabe inteiro.

### Testes
- **`test/cam-broadcast.test.cjs`:**
  - Opus de transmissão idêntico no celular e na mesa;
  - áudio sem filtros, salvo no modo "sem fones";
  - espera de recuperação antes de refazer a conexão.
- **Navegador real (Chromium):**
  - convite pela mesa real, com o vídeo chegando e o áudio a 128 kb/s;
  - fotos do app em retrato e paisagem, nos estados inicial, teste, NO AR e PREVIEW.
- **Política de segurança da página da câmera (CSP):** continua respeitada, sem estilo embutido.
