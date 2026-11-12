# Andrômeda Live 0.13 — câmeras por Internet (Wi-Fi, 4G, 5G) e por Rede local (IP), sem Tailscale

Até a 0.12, o celular só chegava à mesa por um endereço HTTPS que o operador precisava montar: Tailscale ou gateway num VPS. Nesta versão a mesa conecta os celulares sozinha, de dois jeitos novos. Escolha em **Configurações → Convites → 1. Como os celulares se conectam**.

## Modo Internet (padrão)

Para celular em **Wi-Fi, 4G ou 5G, em qualquer lugar**. Nada para instalar nem configurar: o computador só precisa de internet.

1. Deixe marcado **Internet**.
2. Escolha o canal, o nome e a qualidade e toque em **Gerar convite**.
3. Envie o link (ou mostre o QR code). O link tem a forma `https://witterveloso.github.io/andromedalivecam/#r=…`.
4. No celular, abra o link, toque em **Iniciar câmera** e permita câmera e microfone.

Como funciona:

- A página da câmera fica publicada no GitHub Pages (HTTPS, que o celular exige para liberar a câmera).
- Mesa e celular se encontram num **ponto de encontro** público (MQTT sobre WebSocket seguro). Cada convite tem um canal próprio, derivado da chave do convite. Tudo o que passa por ali vai **cifrado com AES-256-GCM**, com chave que só a mesa e quem tem o link conhecem: o ponto de encontro só vê bytes embaralhados.
- Pelo ponto de encontro passam apenas as mensagens de combinação (convite, oferta/resposta WebRTC, tally, intercom). **A imagem e o som vão direto do celular para o computador** por WebRTC, descobrindo o caminho com servidores STUN públicos (Google e Cloudflare).
- A mesa usa três pontos de encontro ao mesmo tempo (HiveMQ, EMQX e Mosquitto). Se um sair do ar, os outros seguem.
- Revogar o convite, gerar outro para o mesmo canal ou deixar o convite expirar (12 horas) desliga o celular na hora.
- O painel mostra "Pronto: ponto de encontro conectado (N de 3)". Se aparecer "Procurando o ponto de encontro…", confira a internet do computador.

Limites, ditos com clareza:

- **Sem servidor TURN.** Na maioria das redes Wi-Fi e operadoras o caminho direto funciona. Algumas redes 4G/5G e redes corporativas bloqueiam conexão direta (NAT simétrico): nesses casos o celular conecta ao convite mas o vídeo não chega. A saída é o modo **Endereço próprio** com o gateway e o TURN do `cloud/` (veja [PUBLICAR.md](PUBLICAR.md)).
- Os pontos de encontro padrão são serviços públicos e gratuitos, sem garantia de disponibilidade. Para uso comercial em escala, use um broker MQTT próprio: na mesa, `ANDROMEDA_RELAY_URLS=wss://seu-broker/mqtt` (vários separados por vírgula); na página da câmera, `window.ANDROMEDA_RELAY = ['wss://seu-broker/mqtt']` em `docs/config.js`.
- O link do convite dá acesso àquele canal: envie só para o operador de câmera.

## Modo Rede local (IP)

Para celular **no mesmo Wi-Fi do computador**. Funciona **sem internet** (por exemplo, num roteador isolado no evento).

1. Marque **Rede local (IP)**.
2. Escolha o IP do computador na lista (o do Wi-Fi ou do cabo; adaptadores de VPN aparecem marcados e por último) e toque em **Ativar rede local**.
3. Se o Windows perguntar, permita o Andrômeda Live em **redes privadas**.
4. Gere o convite. O link tem a forma `https://192.168.x.x:3443/cam/#…`.
5. No primeiro acesso de cada celular aparece um aviso de conexão não particular, porque o certificado é criado pelo próprio computador:
   - Android (Chrome): **Avançado → Continuar para 192.168.x.x**.
   - iPhone (Safari): **Mostrar detalhes → visitar este site**.

Como funciona:

- A mesa abre um servidor HTTPS na porta **3443** do IP escolhido, com certificado próprio que vale para os IPs do computador. O certificado é guardado e reaproveitado; ele só muda quando o IP muda ou faltam 30 dias para vencer, então o aviso aparece uma vez por celular e por rede.
- Página da câmera, sinalização e vídeo ficam dentro da rede local.
- A escolha fica salva: ao reabrir o programa, a rede local volta sozinha. Se aquele IP não existir mais, a mesa volta para o modo Internet e registra o motivo na página Diagnóstico.
- Porta diferente: variável `ANDROMEDA_LAN_PORT`.

Limites:

- O aviso de certificado é inevitável sem um domínio próprio.
- Roteadores com "isolamento de clientes" (comum em Wi-Fi de convidados) impedem o celular de enxergar o computador. Use a rede principal ou o modo Internet.
- No iPhone, o comportamento do Safari com certificado próprio ainda precisa ser confirmado em aparelho real.

## Modo Endereço próprio

É o modo antigo: gateway publicado num VPS ou Tailscale, se você já usa. Nada mudou nele. Com `mesa-cloud.env` instalado, a mesa usa o gateway público e o seletor de modos fica oculto.

## O que foi testado

- Testes automáticos (43, em Ubuntu e Windows na CI):
  - mensagens MQTT divididas;
  - canal e chave diferentes por convite;
  - adulteração recusada;
  - fluxo completo do modo Internet com um ponto de encontro fora do ar: convite, sessão, entrada, sinalização, tally, revogação e convite revogado recusado;
  - servidor HTTPS da rede local: página, sinalização e certificado com o IP;
  - reaproveitamento e renovação do certificado;
  - troca de modo pela API, com a escolha lembrada após reiniciar.
- Ensaio de ponta a ponta em navegador com câmera simulada, nos dois modos ao mesmo tempo: o vídeo chegou ao monitor da mesa, e o tally foi de PREVIEW a NO AR no CUT.
- **Ainda não testado:**
  - celulares reais;
  - redes 4G/5G reais;
  - os pontos de encontro públicos a partir deste ambiente.

  Siga [HOMOLOGACAO.md](HOMOLOGACAO.md) antes da primeira live.
