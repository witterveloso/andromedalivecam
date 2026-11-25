# Andrômeda Live 0.29 — Rede Andrômeda: câmeras no 4G/5G como no Wi-Fi, com tecnologia própria

## 0.29.1 — convite pela internet: a mesa e o celular dizem por que a imagem não chega
- **Causa encontrada.** Montamos uma internet simulada, com a mesa atrás de um roteador doméstico e o celular atrás de um CGNAT de operadora, como no 5G. Nela, o convite abre, o celular e a mesa se encontram, mas a imagem só chega por um destes caminhos:
  - o celular no **mesmo Wi-Fi** da mesa;
  - o **roteador abre a porta** da Rede Andrômeda (UPnP ou encaminhamento manual da porta 3478 UDP/TCP);
  - o **servidor da Rede Andrômeda** da empresa.
- **Sem nenhum dos três, a imagem não chega.** O celular só recebia a retransmissão da rede local, que não se alcança de fora.
  - Um STUN público, como o do Google, que a 0.28 usava, também não resolve no 5G: a simulação mostrou que o vídeo não chega do mesmo jeito.
- **A mesa não promete mais o que não pode cumprir.**
  - Antes, o passo 1 dos convites dizia "o link abre a câmera em qualquer rede" mesmo com o 4G/5G fora do ar.
  - Agora ele avisa quando o convite só funciona no mesmo Wi-Fi e abre sozinho o quadro **Rede móvel (4G/5G)** com o motivo e a solução.
  - Com o servidor da empresa configurado, o quadro mostra "4G/5G pelo servidor da empresa".
- **O celular explica a falha.** Em vez de "Reconectando…", o app da câmera diz que a imagem não chega por aquela rede e o que a mesa precisa fazer.
- **O Diagnóstico registra a falha.** O celular avisa a mesa, que registra no Diagnóstico e no log, uma vez por minuto por câmera, qual câmera ficou sem caminho e por quê.
- **Prova técnica:** `test/sim-5g/` reproduz os quatro cenários com rede de verdade (namespaces de Linux, NAT doméstico e CGNAT simétrico):

| Cenário | Resultado |
|---|---|
| 5G, roteador sem UPnP | não chega; mesa e celular explicam |
| 5G, roteador com UPnP | chega pela retransmissão da mesa |
| mesmo Wi-Fi | chega direto |
| 5G com o servidor da empresa | chega pelo servidor |

## 0.29.0 — retransmissão própria (STUN/TURN), porta aberta no roteador e ponto de encontro próprio
- **Câmera no 5G igual ao Wi-Fi.**
  - No 4G/5G a operadora esconde o celular atrás de um endereço compartilhado (CGNAT). Sem retransmissão, a câmera conectava e a imagem não chegava.
  - Agora a **Rede Andrômeda** retransmite a imagem: STUN/TURN escrito pela Andrômeda (`andromeda-turn.cjs`), sobre UDP e TCP.
  - A retransmissão vem **ligada por padrão, dentro da própria mesa**, na porta 3478.
  - Não usa Cloudflare, Google nem nenhum outro serviço de terceiros.
- **Porta aberta no roteador automaticamente.** A mesa pede ao roteador, por UPnP, para encaminhar a porta 3478 UDP/TCP. O código é próprio, sem biblioteca externa (`upnp.cjs`). A mesa também descobre o IP público e reconhece quando a internet é CGNAT.
  - A tela **Rede móvel (4G/5G)** mostra se o 4G/5G está pronto (porta aberta, IP público, câmeras retransmitidas agora).
  - Se não estiver, a tela diz o motivo e a solução: ligar o UPnP, encaminhar a porta manualmente ou usar o servidor da empresa.
- **Credencial temporária por convite.** Cada câmera recebe uma credencial válida por 24 h, assinada por um segredo que fica só no computador da mesa. Credencial vencida ou de outro segredo é recusada.
- **A retransmissão da mesa não vira porta aberta para a internet.** Ela só entrega mídia para a rede local, ou seja, para a própria mesa.
- **Servidor da Rede Andrômeda para a empresa** (`andromeda-rede.cjs`, kit em `cloud/`): ponto de encontro próprio (`/mqtt`) e a mesma retransmissão com IP público, para mesas atrás de CGNAT.
  - Substitui o coturn do kit antigo, que limitava cada câmera a 2 Mbps.
  - Com o `mesa-cloud.env` da empresa:
    - o convite leva ao celular o endereço do ponto de encontro próprio (`#r=…&p=wss://…/mqtt`), sem servidores MQTT públicos;
    - a retransmissão da empresa entra como reserva da retransmissão da mesa.
  - Instruções em `REDE_ANDROMEDA.md`.
- **Sem STUN de terceiros.** Saíram o STUN do Google e o da Cloudflare das câmeras. A Cloudflare não aparece mais como opção na tela; quem já tinha configurado passa para a Rede Andrômeda.
- **Windows.** Na primeira vez, o Windows pergunta se o Andrômeda Live pode receber conexões: clique em **Permitir**.

- **Transmissão: nenhuma perda numa trava curta da rede.** A fila de cada destino passou de ~1 s para ~4 s.
  - Antes, uma trava de 3,5 s da rede ou da plataforma descartava ~60 quadros, junto com um quadro-chave: o intervalo entre quadros-chave ia a 4 s, fora da diretriz de 2 s, e a imagem ficava corrompida até o próximo.
  - Era essa a falha que aparecia de vez em quando no diagnóstico 4K do CI.
  - Agora chegam 360 de 360 quadros, com quadro-chave a cada 2 s.
  - Sem trava, a fila fica vazia e não soma atraso.

### O que ainda usa terceiros (e como eliminar)
- **Ponto de encontro sem servidor da empresa.** Sem o servidor da Rede Andrômeda no ar, a conversa inicial entre celular e mesa ainda passa pelos servidores MQTT públicos de antes. As mensagens vão cifradas de ponta a ponta. Com o servidor da empresa configurado, eles deixam de ser usados.
- **Página do app da câmera.** Continua publicada no GitHub Pages. Pode ser hospedada no mesmo servidor da empresa (`configure.py`: deixe a URL do GitHub Pages em branco).

### Testes
- **Automáticos (`test/rede-andromeda.test.cjs`):**
  - STUN com FINGERPRINT válido;
  - autenticação: 401, credencial vencida e credencial de outro segredo recusadas, alocação aceita;
  - UPnP contra um roteador simulado, incluindo o reconhecimento de CGNAT;
  - a mesa sem nenhum servidor de terceiros;
  - o ponto de encontro com o cliente real do app, e outro convite sem escutar a conversa;
  - mesa e empresa juntas, com credencial válida.
- **Navegador real (Chromium):** com o "celular" forçado a usar só retransmissão (sem caminho direto, como no 5G), o vídeo chegou à mesa a 30 fps, por UDP e por TCP, e a resolução subiu normalmente.
