# Andrômeda Live 0.35 — Multiplataforma, produção vertical 9:16, Gravação Andrômeda, ponto sem a própria voz e pacote de GCs

## 0.35.1
- **Produção vertical 9:16: bordas pretas nos monitores.** No PGM/AR e no PREVIEW, a imagem em pé aparece centralizada com bordas pretas lisas dos lados, como numa TV. Antes, os lados eram listrados. As bordas são só do monitor da mesa: o que vai ao ar continua sendo a imagem em pé inteira, sem bordas.
- **Modelos de GC com dois cliques:** dois cliques num modelo da galeria já aplicam o modelo no programa, sem precisar clicar em "Aplicar ajustes ao programa". Um clique continua escolhendo o modelo para personalizar antes.
- **Prévia dos efeitos mostra o modelo de cada GC:** passe o mouse sobre um modelo da galeria e a prévia mostra como ele fica em cima da imagem real. Ao tirar o mouse, volta ao escolhido. Com o GC ainda sem nome e cargo, a prévia usa um texto de exemplo ("Nome da Pessoa / Cargo ou função") para o modelo aparecer. O texto de exemplo nunca vai ao ar.
- **Botão GC nos Comandos:**
  - **Um clique** põe no ar o crédito que está no ponto. Outro clique tira do ar, e o próximo da lista já fica no ponto para o clique seguinte.
  - **Dois cliques** abrem as configurações do GC (página GC e efeitos). Ali ficam os modelos, as cores e a **lista de créditos (sequência)**: adicionar, ordenar e escolher o que fica no ponto.
- **4G/5G: todos os caminhos ligados juntos (regra).** A câmera no 4G/5G precisa de um caminho pela internet até a mesa. Antes, a mesa usava um caminho de cada vez: ou a Rede Andrômeda (porta aberta no roteador) ou a Cloudflare. Escolher de novo a Rede Andrômeda apagava a chave da Cloudflare, e se o roteador não abrisse a porta, o celular ficava "EM ESPERA" sem imagem.
  - Agora a Rede Andrômeda desta mesa fica sempre ligada.
  - A Cloudflare e o servidor da empresa, quando configurados, somam caminhos a ela, e o celular usa o primeiro que funcionar.
  - A tela "Rede móvel (4G/5G)" mostra os caminhos ligados (por exemplo "Rede Andrômeda + Cloudflare") e permite remover cada extra.
  - Com a chave da Cloudflare salva uma vez, a câmera chega no 4G/5G mesmo com o roteador fechado.
- **Andrômeda Cam: troca de rede sem cair.**
  - Quando o celular troca de rede (o Wi-Fi some, ou passa do Wi-Fi para o 5G e vice-versa), o app refaz só o caminho da imagem pelo sinal novo, na mesma conexão com a mesa. Leva cerca de 1 a 2 s.
  - Antes, o app esperava 6 s e reconectava tudo.
  - Se ainda assim não voltar, reconecta tudo, como antes.
  - Testado: no ensaio com a live no ar, o caminho da imagem foi derrubado e voltou pelo caminho novo, sem reconectar à mesa e sem tirar a live do ar.
- **Andrômeda Cam: PARAR com confirmação.** O primeiro toque em PARAR só arma: o botão mostra "TOQUE DE NOVO". O segundo toque, em até 3 s, desliga a câmera. Sem o segundo toque, volta a PARAR. Assim um toque sem querer não derruba a câmera no ar.
- **Andrômeda Cam: tarja menor.** A tarja de PREVIEW / NO AR / EM ESPERA ficou menor e tapa menos a imagem.
- **Andrômeda Cam: imagem em pé com o celular em pé.** Com o celular na vertical, a câmera agora envia imagem vertical (9:16, por exemplo 1080×1920). Na horizontal, envia 16:9, como antes.
  - Girar o celular com a câmera ligada (ou no ar) gira a imagem junto, sem desligar a câmera e sem cair da mesa.
  - Na mesa, em produção vertical 9:16, a câmera em pé preenche a tela inteira. Em produção horizontal, ela aparece inteira, com fundo desfocado dos lados.
  - Antes, o app sempre pedia imagem deitada e mostrava "Gire o celular".
- **Andrômeda Cam: microfone externo reconhecido sozinho.** Conectou um microfone no celular, é ele que vai para a mesa. Vale para microfone com fio (fone com microfone), USB-C, Lightning, receptor de microfone sem fio (DJI, Rode, Hollyland, Boya…) e Bluetooth.
  - Tirou o microfone: volta na hora o microfone do celular (áudio ambiente), sem derrubar a câmera nem a live.
  - Já conectado ao abrir o app: entra direto o externo.
  - Prioridade: com fio/USB antes de Bluetooth. O Bluetooth do celular grava em qualidade de telefone, e o app avisa.
  - A faixa de dados mostra "MIC EXTERNO · nome do microfone" ou "MIC DO CELULAR".
  - Na mesa, a lista de câmeras do intercom mostra o microfone de cada câmera, e o registro anota quando um externo entra ou sai.
  - Em Ajustes › Áudio, "Automático" é o padrão. Escolher um microfone ali fixa esse microfone.
  - O retorno do DTV continua chegando no fone ou no microfone com fone que estiver conectado (o celular manda o som para ele).
- **Andrômeda Cam: retorno do DTV sempre ligado.** Toda câmera recebe o DTV nos fones sozinha, sem botão para liberar o retorno.
  - O único botão do intercom no celular é chamar o DTV (SEGURE P/ FALAR).
  - Quando o DTV fala, aparece um aviso discreto "DTV FALANDO" no alto da imagem, com barrinhas de áudio. O aviso some quando ele para de falar.
  - Se o aparelho segurar o som mesmo assim, o primeiro toque em qualquer lugar da tela libera o retorno, sem aviso.
  - Testado na mesa: o retorno tocou sozinho no celular, o aviso apareceu quando o DTV falou e sumiu quando ele parou, com a live no ar.
- **Andrômeda Cam: visual broadcast, em pé e deitado.** O visor virou um painel de câmera de transmissão, com placas escuras sólidas e cantos retos, sem vidro desfocado por cima da imagem.
  - **Topo:** tarja NO AR / PREVIEW, nome da câmera e botões, numa linha só.
  - **Ajustes** (lente, formato, zoom, WB, exposição, estabilização, foco) como painel de instrumentos. Deitado, ficam num trilho vertical à esquerda e o ajuste abre ao lado. Em pé, ficam numa grade logo abaixo do topo, todos à vista.
  - **Deitado:** trilho à direita com o timecode (bolinha vermelha piscando quando está NO AR), o medidor de áudio na vertical em toda a altura, a luz de CLIP, o MIC, o botão do AR e o intercom.
  - **Dados de transmissão** numa faixa única com divisórias. O enlace tem barras de sinal (3 = bom, 2 = instável, 1 = fraco) e a bateria tem ícone.
- **Teste de autorrecuperação no Windows:** o teste agora espera a gravação terminar de ser juntada antes de limpar a pasta.


## Várias plataformas ao mesmo tempo, com gravação junto
A mesa monta e codifica **uma imagem só** (16:9). O serviço Andrômeda distribui essa imagem para cada destino e cria dela a versão 9:16 para Instagram e TikTok, usando a placa de vídeo quando houver (Intel Quick Sync, NVIDIA, AMD).

- **Menos peso no computador.** Antes, a mesa montava e codificava duas imagens (16:9 e 9:16). No diagnóstico enviado, isso deixava o notebook a 2,7 quadros por segundo.
- **Qualquer plataforma entra no meio da live.** Pode começar só com o Instagram e pôr o YouTube no ar depois, ou o contrário, sem parar a transmissão. Antes, o YouTube não entrava numa live que começou só com o Instagram.
- **Mesma plataforma em mais de uma conta.** Por exemplo, YouTube conta 1 e conta 2: cada destino tem a sua chave, a sua conexão e reconexão própria. Uma conta que cai não derruba a outra.
- **Enquadramento 9:16 ao vivo.** Mudar o recorte com a live no ar não derruba o Instagram nem o TikTok: a imagem nova é emendada na mesma conexão.
- **Gravação 16:9 e 9:16 juntas.** A gravação 9:16 é a mesma imagem que vai ao ar, num arquivo só do começo ao fim, mesmo que o recorte mude no meio.

## Produção vertical 9:16 (live só para Instagram ou TikTok)
Novo quadro **Formato da produção** na página Transmissão, com três opções:

- **Automático (padrão).** A mesa fica na vertical quando todos os destinos da live são 9:16. Isso conta também os destinos prontos que vão entrar depois, em espera ou desligados. Basta um YouTube pronto para a live ser horizontal.
- **Horizontal 16:9.**
- **Vertical 9:16.**

Na produção vertical:

- **O PGM fica em pé (1080×1920, 30 fps)** e sai como uma imagem só, sem recorte, para todos os destinos 9:16 e para a gravação.
- **Sem bordas laterais.** Câmeras deitadas (16:9) preenchem a tela em pé. Celulares em pé ocupam a tela inteira.
- **Monitores PGM e PREVIEW em pé**, com o selo VERTICAL 9:16 e bordas pretas dos lados. As bordas são só do monitor da mesa e não vão ao ar.
- **GC, logotipo e janela se ajustam à tela em pé.** O GC de baixo fica acima da área de comentários do Instagram e do TikTok.
- **O mosaico se reorganiza na vertical.**
- **Destinos 16:9 ficam de fora.** A mesa avisa antes de começar e não deixa um destino 16:9 entrar numa live vertical.
- **A gravação sai em 9:16.**
- **O formato fica travado durante a live.** Para trocar, encerre a live.

## Instagram e TikTok: nada cortado, fundo sem manchas
- **O 16:9 inteiro aparece em qualquer celular.** Em celulares mais altos que 9:16 (a maioria dos iPhones e Androids atuais), o Instagram e o TikTok enchem a tela cortando as laterais da live, cerca de 9% de cada lado. Nos modos "Inteira · fundo desfocado" e "Inteira · barras pretas", o quadro 16:9 agora ocupa 80% da largura, dentro da área que aparece em qualquer aparelho. Antes, as pontas eram cortadas (por exemplo, as letras das bordas do logotipo).
- **Fundo desfocado sem pontos brancos.** O fundo agora é só cor difusa e escurecida. Antes, letras e relógio claros apareciam no fundo como manchas brancas.
- **GC, logotipo e janela na tela em pé** ficam dentro da área segura: longe das laterais cortadas, abaixo do cabeçalho do Instagram (nome e "Ao vivo") e acima dos comentários.

## Gravação Andrômeda: a gravação acompanha a transmissão do começo ao fim
A gravação é feita junto com a transmissão, da mesma imagem que vai às plataformas, mas por um caminho próprio. Problema no disco não derruba a live, e problema na live não derruba a gravação.

- **Gravador próprio para cada formato (16:9 e 9:16).** Funciona ao lado dos destinos, só copiando a imagem (não codifica de novo). O codificador da transmissão não escreve mais no disco.
- **Fila de 256 MB (640 MB em 4K).** Um disco lento ou travado por minutos (HD externo, antivírus) não faz perder nada nem atrasa a live.
- **Volta sozinha se o disco falhar.** Por exemplo: disco cheio, HD desconectado ou pasta sem permissão. A gravação retoma numa parte nova, nunca por cima da anterior. A mesa avisa o motivo e avisa de novo quando voltar a gravar.
  - Antes, a gravação 16:9 podia parar em silêncio.
  - Antes, a 9:16 podia regravar o próprio arquivo do zero se o gravador reiniciasse.
- **Um arquivo só no fim.** As partes (de um recomeço do gravador ou do codificador) são juntadas num MP4 a 30 fps exatos. Partes de formatos diferentes, por exemplo se a resolução mudou no meio, ficam em arquivos separados.
- **Espaço livre vigiado durante a live.** A mesa avisa quando restam cerca de 20 minutos de gravação e de novo com 5 minutos.
- **Testado:** o gravador foi derrubado no meio da live. A transmissão não reiniciou, a gravação voltou sozinha na parte 2 e, no fim, saiu um arquivo só com as duas partes. Um disco travado por 3,5 s não abriu buraco na transmissão e a gravação ficou completa.

## PONTO: retorno do programa sem a própria voz (mix-minus)
- Quem está no ar (repórter, apresentador) ouve a programação no ponto, mas não ouve a própria voz voltando com atraso.
- **Como configurar:** no painel do PONTO, cada pessoa tem **"Retorno sem a voz de"**. Escolha o canal por onde a voz dela entra no programa: a câmera dela (Andrômeda Cam), outra fonte da mesa ou o microfone da transmissão. O retorno dela passa a ser o programa inteiro menos esse canal, subtraído na própria mistura de áudio da mesa.
- A voz da direção continua chegando normalmente.
- **Medido:** a voz do repórter caiu de −22,5 dB para −188 dB (silêncio) no retorno dele, e o programa ficou igual.

## Pacote de GCs: 12 modelos de tarja
- **Galeria na página "GC e efeitos":** Clássico, Tarja dupla, Telejornal, Moderno, Vidro, Minimalista, Esportivo, Plantão, Etiqueta, Neon, Cartão e Redes sociais. As miniaturas mostram o texto do próprio GC.
- **Um clique escolhe o modelo** com as cores sugeridas dele, para personalizar. **Dois cliques já aplicam no programa.**
- **Personalização:** cores, tamanho, largura, posição e opacidade continuam editáveis. Há um campo novo de **selo** (AO VIVO, URGENTE…).
- **"Salvar como meu modelo"** guarda a sua versão em **Meus modelos**.
- **O visual do GC é lembrado** ao fechar e abrir o programa.
- **Vale também** para os créditos programados e para a tela em pé (área segura do Instagram/TikTok).

## Testado
- **Mesa real, horizontal:** live iniciada com o Instagram. YouTube conta 1 e conta 2 entraram no meio, em 1920×1080 (409 quadros cada). O recorte 9:16 mudou ao vivo sem reconectar o Instagram. Saíram duas gravações: 16:9 em 1920×1080 e 9:16 em 1080×1920, cada uma num arquivo só.
- **Mesa real, vertical:** live só com o Instagram e câmera deitada no PGM. Saída e gravação em 1080×1920, com a imagem chegando até as duas laterais, sem bordas pretas.
- **Testes automáticos:** os testes completos do serviço passaram, incluindo os 3 novos de multiplataforma, e também os testes de interface (incluindo o novo do formato da produção).
