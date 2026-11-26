# Andrômeda Live 0.30 — Andrômeda Cam como câmera de transmissão

## 0.30.2 — qualquer rede, qualquer computador: Wi-Fi, cabo, troca de rede e firewall
- **A mesa reconhece a rede sozinha.**
  - **Antes:** a retransmissão das câmeras pegava o primeiro endereço que parecesse de rede local e nunca mais o trocava. Isso falhava em três casos:
    - computador ligado direto no modem, com IP público ou compartilhado: a mesa entregava 127.0.0.1 ao celular;
    - troca do Wi-Fi para o cabo com o programa aberto: a mesa continuava com o endereço antigo;
    - placas virtuais (Hyper-V/WSL, VirtualBox, VPN): uma delas podia ser escolhida no lugar da placa real.
  - **Agora:** a mesa usa a placa por onde o computador realmente sai para a internet (cabo ou Wi-Fi) e entrega ao celular todos os endereços reais. As placas virtuais ficam de fora.
  - **Ligado direto no modem:**
    - com IP público, o celular no 4G/5G chega direto, sem precisar de roteador;
    - com IP de CGNAT, a tela explica que só o servidor da Rede Andrômeda resolve, ou ligar o computador no mesmo roteador do Wi-Fi das câmeras.
- **Troca de rede com a live no ar** (Wi-Fi ↔ cabo). A mesa confere a rede a cada 10 s. Quando ela muda, a mesa:
  1. registra a troca no Diagnóstico;
  2. abre a porta no roteador para o endereço novo;
  3. reconecta o ponto de encontro;
  4. pede a cada câmera para reconectar já pelo endereço novo.
- **Conexão morta não fica pendurada.** O ponto de encontro (na mesa e no celular) reconecta sozinho depois de 25 s sem resposta. O celular também reconecta assim que o sistema avisa que a rede voltou ou mudou (Wi-Fi ↔ 5G).
- **Firewall do Windows em computador novo.**
  - O problema: se o "Permitir" foi recusado, ou só valeu para redes privadas e a rede atual é "Pública" (o padrão do Windows para cabo e Wi-Fi novos), o Windows bloqueia as câmeras sem avisar.
  - A mesa agora confere isso ao abrir e a cada troca de rede, e avisa no Diagnóstico.
  - O quadro **Rede móvel (4G/5G)** ganhou o botão **Liberar no firewall do Windows**. Ele pede o administrador uma única vez, remove os bloqueios do próprio programa e libera a entrada em qualquer rede.
- **Andrômeda Cam.** O texto do botão principal ("ATIVAR CÂMERA") saía para fora do círculo. Agora quebra entre as palavras e cabe inteiro, em retrato e em paisagem.

### Provas
- **Rede simulada de verdade** (`test/sim-5g/`), com a mesa trocando de "Wi-Fi" (192.168.1.10) para "cabo" (192.168.1.11) no meio da transmissão:

| Celular | Resultado |
|---|---|
| no Wi-Fi da casa (`troca.sh`) | o vídeo voltou sozinho em 6 a 11 s |
| no 5G, atrás de CGNAT, com roteador UPnP (`troca5g.sh`) | o vídeo voltou sozinho em 9 s |

- **No 5G, antes desta correção, o vídeo não voltava.**
  - O ponto de encontro ficava preso à conexão do endereço antigo.
  - As câmeras eram chamadas a reconectar antes de o roteador abrir a porta nova.
- **Testes automáticos:**
  - troca Wi-Fi → cabo → modem direto (IP público e CGNAT);
  - placas virtuais ignoradas;
  - regras do firewall (bloqueio, permissão, rede pública e privada);
  - pedido de administrador;
  - leitura real do firewall no Windows do CI.

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
