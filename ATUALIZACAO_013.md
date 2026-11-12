# Andrômeda Live 0.13 — câmeras sem Tailscale, Blackmagic sem piscar e mesa do seu jeito

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

## Mesa do seu jeito: tamanho e lugar de cada painel

Na página **Operação**, cada painel (Preview, PGM, Câmeras, Corte e transições, Seleção de fontes, Camadas, Áudio, Intercom) tem tamanho e posição livres.

1. Toque em **Personalizar** no topo. A grade aparece e cada painel mostra o tamanho (por exemplo `16 × 22`).
2. **Mover:** arraste o painel pelo título.
3. **Tamanho:** arraste o canto inferior direito (◢).
4. **Teclado:** com o título selecionado (Tab), as setas movem e Shift + setas mudam o tamanho.
5. Toque em **Concluir** (ou Esc).

Como funciona:

- A grade tem 48 colunas e 48 linhas por tela, e acompanha o tamanho da janela.
- Um painel solto sobre outro empurra o outro para baixo, sem sobrepor.
- **Juntar painéis** sobe tudo e tira os espaços vazios.
- **Modelos prontos:**
  - **Padrão · monitores menores** (o novo padrão);
  - **Câmeras em destaque**;
  - **Monitores grandes** (parecido com a 0.12).
- Preview e PGM sempre mostram a imagem inteira em 16:9 no espaço que você deu. Lado a lado e com a mesma altura, os dois ficam do mesmo tamanho.
- As miniaturas das câmeras se reorganizam em colunas para caber no painel.
- Durante a edição, os botões dos painéis não respondem: ajustar a mesa nunca corta nem muda o AR.
- Em **Configurações → Personalizar a mesa** há a tabela completa:
  - página de cada painel (dá para levar um painel da Operação para outra página e voltar);
  - coluna, linha, largura e altura em números;
  - exportar e importar o layout.
- O layout fica salvo neste computador. Layouts da 0.12 não são reaproveitados: a mesa abre no padrão novo, com Preview e PGM menores e todas as câmeras visíveis numa tela Full HD.

Em telas de 1366 × 768 a grade não encolhe abaixo de 18 px por linha: a página rola um pouco em vez de deixar os monitores minúsculos.

## Correções

- **Blackmagic piscando.** A imagem da entrada RTMP sumia por um ou dois quadros várias vezes por segundo no PGM, no Preview e na miniatura, e portanto também na transmissão.
  - Causa: cada quadro novo era carregado na mesma imagem que a mesa estava desenhando, e enquanto o JPEG decodificava a imagem ficava vazia.
  - Correção: agora o quadro é decodificado numa imagem de reserva e só entra quando está pronto.
  - Medição com um sinal RTMP de teste no PGM: antes, 44 de 300 quadros saíam vazios (15%); agora, nenhum.
- **Medidor de áudio tremendo.** As barras pulavam a cada 50 ms para o pico instantâneo, e o número em dBFS mudava de largura e empurrava a barra.
  - Agora o medidor sobe na hora e desce suave (20 dB por segundo, como um PPM).
  - O número mostra o maior pico de cada 250 ms, com largura fixa.
  - A marca de pico continua retida por 1 segundo.

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
- Blackmagic: sinal RTMP de teste (FFmpeg) na entrada da CAM 1, contagem de quadros vazios no PGM antes e depois da correção (44/300 → 0/300).
- Mesa livre: arrastar, redimensionar, empurrar sem sobrepor, salvar e reabrir, nas larguras 1920 e 1366.
- Ensaio de ponta a ponta em navegador com câmera simulada, nos dois modos ao mesmo tempo: o vídeo chegou ao monitor da mesa, e o tally foi de PREVIEW a NO AR no CUT.
- **Ainda não testado:**
  - celulares reais;
  - redes 4G/5G reais;
  - os pontos de encontro públicos a partir deste ambiente.

  Siga [HOMOLOGACAO.md](HOMOLOGACAO.md) antes da primeira live.
