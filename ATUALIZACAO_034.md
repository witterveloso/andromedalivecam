# Andrômeda Live 0.34 — PONTO, créditos programados, câmeras no 4G/5G de volta

## PONTO: a direção fala com o apresentador e o repórter
Caminho próprio, separado do intercom dos operadores de câmera: convites, canal cifrado e conexão de áudio só do PONTO.

- **Na mesa, o botão PONTO fica no quadro Comandos.**
  - **Toque:** abre e fecha a fala da direção.
  - **Dois cliques:** abrem o painel do PONTO, com:
    - links para até 4 pessoas no ar (Apresentador, Repórter…), com botão para enviar pelo WhatsApp;
    - escolha de com quem falar (todos ou um só);
    - botão "segure para falar";
    - avisos escritos prontos ("30 segundos", "1 minuto", "Encerra", "Chama o VT", "Olha a câmera", "Estica", "Intervalo") ou livres.
  - Também há um atalho de teclado configurável.
- **No celular de quem está no ar,** o link abre o app do ponto (sem instalar nada). Coloque o fone e toque em **Entrar no ponto**.
  - Ouve a voz da direção, e o aviso **DIREÇÃO FALANDO** aparece em vermelho.
  - Os avisos escritos aparecem grandes na tela, com vibração.
  - **Retorno do programa:** cada pessoa no ar pode ligar. Ele abaixa sozinho quando a direção fala.
  - **Segure para falar com a direção:** o microfone só abre enquanto o botão está pressionado. Na mesa, o botão PONTO mostra "☎ Apresentador chamando".
- O link vale 7 dias desde o último uso, mesmo depois de fechar e abrir o programa. Revogar encerra na hora.

## GC · créditos programados
- **Abrir a lista:** dois cliques no botão GC. Ali você programa os créditos do programa (nome e função) e escolhe qual fica **NO PONTO**.
- **No ar:** um toque no GC põe no ar o crédito que está no ponto. Outro toque tira do ar, e o próximo da lista já fica no ponto ("Avançar sozinho", ligado por padrão).
- **Sem abrir a lista:** os atalhos **GC · próximo crédito no ponto** e **GC · crédito anterior no ponto** trocam o crédito do ponto.
- **Visual:** cor, posição e tamanho continuam sendo os do GC · Créditos (página GC e efeitos).
- **Sem créditos na lista:** o GC funciona como antes.

## Câmeras com a live no ar e pelo mesmo link
- **Com a live no ar:** a mesa gera convites e recebe câmeras novas normalmente. Teste: com a live no ar, a mesa gerou o convite e a câmera conectou e mandou imagem.
- **Mesmo link:** a câmera volta pelo mesmo link quando o celular reconecta ou a página é reaberta, mesmo com a conexão antiga ainda aberta (antes, a mesa recusava). Se o link for aberto em outro aparelho, o anterior é avisado e não fica disputando a câmera.
- **Convites guardados:** continuam valendo depois de fechar e abrir o Andrômeda Live, por 7 dias desde o último uso (antes valiam 12 h e se perdiam ao fechar o programa).

## Câmera no 4G/5G pela Rede Andrômeda (o nosso sistema), mais forte
A Rede Andrômeda continua sendo a retransmissão padrão e recomendada. Para o celular no 4G/5G chegar à mesa, o roteador
precisa liberar a porta, e a mesa pede isso sozinha. Esse pedido falhava em algumas redes ("nenhum roteador com UPnP
respondeu"), principalmente em redes Mesh. Agora a mesa tenta três caminhos:
- **Busca do roteador em todas as placas de rede e direto no endereço do roteador.** Num computador com placa virtual (Hyper-V, WSL, VirtualBox, VPN), a busca saía pela placa errada e o roteador não ouvia.
- **NAT-PMP:** muitos roteadores Mesh e Apple liberam a porta por NAT-PMP, e não por UPnP. A mesa tenta os dois.
- **Dois roteadores (Mesh atrás do modem da operadora):** a mesa libera a porta no Mesh e também no modem, apontando para o Mesh.
- **Nova tentativa sozinha:** enquanto o 4G/5G estiver fechado, a mesa tenta de novo a cada minuto. Basta ligar o UPnP no roteador, sem reiniciar o programa.
- **Na tela, uma frase só:**
  - "Pronto: o link funciona no Wi-Fi e no 4G/5G";
  - ou o que fazer: "ative o UPnP (ou NAT-PMP) no roteador" ou, com dois roteadores, "ative o UPnP no modem da operadora ou ponha o Mesh em modo ponte".
  - O aviso do firewall só aparece quando ele está bloqueando.
- **Opções da tela:** a Cloudflare continua disponível como alternativa, ao lado do servidor da Rede Andrômeda da empresa.

## Gravação 16:9 e 9:16 ao mesmo tempo
- **Antes:** com o computador no limite, a mesa desligava a gravação 9:16 sozinha, e o arquivo vertical não aparecia.
- **Agora:** as duas gravações continuam, como o operador escolheu; a mesa só avisa que o computador está no limite.
- **Teste:** os dois arquivos saem com a mesma duração, 1920×1080 e 1080×1920.

## NO AR no topo
- **Transmitindo:** o estado ao lado do tempo de transmissão mostra **NO AR** em vermelho, com a luz piscando.
- **Só gravando:** mostra **GRAVANDO**.

## Provas
- **PONTO de ponta a ponta** (`test/ponto-e2e.cjs`): mesa real + app do apresentador + ponto de encontro próprio da Rede Andrômeda, medindo o áudio de verdade.
  - **Voz da direção no fone:** nível 0,29 com a direção falando, contra 0,000 em silêncio.
  - **Aviso escrito:** aparece na tela do apresentador.
  - **Chamada do apresentador:** a voz dele chega na mesa.
  - **Retorno do programa e revogação:** funcionam.
- **Câmera com a live no ar** (`test/camera-live-e2e.cjs`): convite gerado com a live no ar, câmera conectada com imagem, volta pelo mesmo link, e a live seguiu no ar o tempo todo.
- **Testes automáticos do serviço:**
  - PONTO: sinalização e avisos só para o ponto certo, mesmo link, revogação e convites guardados;
  - câmera: reconexão pelo mesmo link e convite que sobrevive a reabrir o programa.
- **Rede Andrômeda:**
  - NAT-PMP com um roteador de verdade (UDP);
  - NAT duplo com dois roteadores simulados (Mesh → modem);
  - roteador achado pela tabela de rotas do Windows e do Linux;
  - simulação de 5G com rede de verdade (celular atrás de CGNAT, mesa atrás de roteador): a imagem chegou.
- **Teste da mesa:** playlist do GC (ponto → no ar → próximo no ponto) e botão PONTO nos Comandos.

## O que fica com você
- **4G/5G pela Rede Andrômeda:** deixe "Rede Andrômeda nesta mesa" escolhido. Se a tela pedir, ligue o UPnP (ou NAT-PMP) no roteador. Com Mesh atrás do modem da operadora, ligue o UPnP também no modem ou ponha o Mesh em modo ponte. A mesa tenta de novo sozinha.
- **Nos celulares do PONTO:** use fones. O microfone só abre enquanto a pessoa segura o botão.
