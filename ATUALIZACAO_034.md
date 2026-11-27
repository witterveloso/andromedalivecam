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

## Câmera no 4G/5G de novo, em qualquer rede
- **O que tinha acontecido.** Até a 0.28, a câmera chegava no 4G/5G pela retransmissão Cloudflare. Na 0.29, a retransmissão passou a rodar dentro da própria mesa e a opção Cloudflare saiu da tela. Essa retransmissão só funciona no 4G/5G quando o roteador abre a porta (UPnP), o que muitos roteadores não fazem. Por isso parou.
- **Agora:**
  - a opção **Cloudflare · funciona em qualquer rede (recomendado)** está de volta, com os campos Key ID e API token;
  - as outras opções continuam: Nesta mesa (precisa de UPnP), Servidor da Rede Andrômeda (empresa) e Desligada.
- **Tela de convites mais simples:** uma frase só ("Pronto: o link funciona no Wi-Fi e no 4G/5G" ou "Pronto no Wi-Fi. Para o 4G/5G, configure…"). O aviso do firewall só aparece quando ele está bloqueando.

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
- **Teste da mesa:** playlist do GC (ponto → no ar → próximo no ponto) e botão PONTO nos Comandos.

## O que fica com você
- **Para o 4G/5G voltar no seu computador:**
  1. Vá em Convites → Rede móvel (4G/5G) e escolha **Cloudflare**.
  2. Cole o Key ID e o API token da chave TURN da Cloudflare (painel da Cloudflare → Realtime → TURN Server). Se você não tiver mais o token, crie uma chave nova lá.
  3. Clique em **Salvar e testar**.
- **Nos celulares do PONTO:** use fones. O microfone só abre enquanto a pessoa segura o botão.
