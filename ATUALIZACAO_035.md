# Andrômeda Live 0.35 — Tecnologia Andrômeda Multiplataforma e produção vertical 9:16

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
- **Monitores PGM e PREVIEW em pé**, com o selo VERTICAL 9:16. A área hachurada dos lados é só a moldura do monitor e não vai ao ar.
- **GC, logotipo e janela se ajustam à tela em pé.** O GC de baixo fica acima da área de comentários do Instagram e do TikTok.
- **O mosaico se reorganiza na vertical.**
- **Destinos 16:9 ficam de fora.** A mesa avisa antes de começar e não deixa um destino 16:9 entrar numa live vertical.
- **A gravação sai em 9:16.**
- **O formato fica travado durante a live.** Para trocar, encerre a live.

## Instagram e TikTok: nada cortado, fundo sem manchas
- **O 16:9 inteiro aparece em qualquer celular.** Em celulares mais altos que 9:16 (a maioria dos iPhones e Androids atuais), o Instagram e o TikTok enchem a tela cortando as laterais da live, cerca de 9% de cada lado. Nos modos "Inteira · fundo desfocado" e "Inteira · barras pretas", o quadro 16:9 agora ocupa 80% da largura, dentro da área que aparece em qualquer aparelho. Antes, as pontas eram cortadas (por exemplo, as letras das bordas do logotipo).
- **Fundo desfocado sem pontos brancos.** O fundo agora é só cor difusa e escurecida. Antes, letras e relógio claros apareciam no fundo como manchas brancas.
- **GC, logotipo e janela na tela em pé** ficam dentro da área segura: longe das laterais cortadas, abaixo do cabeçalho do Instagram (nome e "Ao vivo") e acima dos comentários.

## Testado
- **Mesa real, horizontal:** live iniciada com o Instagram. YouTube conta 1 e conta 2 entraram no meio, em 1920×1080 (409 quadros cada). O recorte 9:16 mudou ao vivo sem reconectar o Instagram. Saíram duas gravações: 16:9 em 1920×1080 e 9:16 em 1080×1920, cada uma num arquivo só.
- **Mesa real, vertical:** live só com o Instagram e câmera deitada no PGM. Saída e gravação em 1080×1920, com a imagem chegando até as duas laterais, sem bordas pretas.
- **Testes automáticos:** os testes completos do serviço passaram, incluindo os 3 novos de multiplataforma, e também os testes de interface (incluindo o novo do formato da produção).
