# Andrômeda Live 0.31 — proteção contra cópia

## 0.31.0 — proteção do Andrômeda Live e dos seus recursos
- **Código protegido dentro do instalador.**
  - Todo o código próprio (serviço, programa e mesa, inclusive os scripts da página) vai compactado: sem comentários, sem espaços, com os nomes internos trocados por letras.
  - Cada arquivo leva o aviso de direitos autorais.
  - O app da câmera publicado (GitHub Pages) também vai compactado.
  - As explicações e regras que estavam nos comentários do código não saem mais no pacote.
- **Programa trancado contra adulteração** (fusíveis do Electron).
  - **Bloqueado:**
    - abrir o executável como Node (`ELECTRON_RUN_AS_NODE`), um caminho comum para ler e alterar o código;
    - injetar código por `NODE_OPTIONS`;
    - depurar por `--inspect`.
  - **Exigido:** o programa só carrega o pacote original (`app.asar`), conferido por integridade.
- **Sem console de desenvolvedor no programa instalado.** O Ctrl+Shift+I não abre nada.
- **A mesa só abre dentro do programa.**
  - Cada vez que o programa abre, ele cria uma chave nova e a envia em todos os pedidos da janela.
  - Um navegador comum em `http://localhost:3180` recebe "acesso negado" (403): não dá para abrir a mesa no Chrome e salvar as páginas.
  - Medido: sem a chave, `/`, `/broadcast.js` e `/api/session` dão 403; com a chave, 200.
- **Licença presa ao computador.**
  - Cada computador tem um código próprio (Diagnóstico → Licença), tirado do identificador do Windows.
  - A licença emitida para esse código só funciona nele: copiar o `licenca.txt` para outro computador não ativa.
  - Para emitir: `node tools/licenca.cjs emitir --plano anual --cliente "Nome" --computador XXXX-XXXX-XXXX-XXXX`.
- **Proteção legal.**
  - O instalador mostra o **Contrato de Licença de Uso**, que precisa ser aceito.
  - O contrato proíbe cópia, engenharia reversa, modificação e redistribuição, com base nas Leis 9.610/98 e 9.609/98.
  - O repositório ganhou `LICENSE.txt` (software proprietário, todos os direitos reservados).
- **Diagnóstico discreto.** Continua gravando tudo o tempo todo, em arquivo, mas a aba não mostra mais o contador de avisos.
- **Plano B mais leve.** Sem placa de vídeo que codifique, o x264 usa o modo "superfast", que gasta cerca de metade do processador.

### Provas
- **Programa protegido, gerado como o instalador gera** (código compactado e fusíveis aplicados):
  - abriu e carregou a mesa inteira;
  - tentativa de rodar como Node: bloqueada;
  - transmissão 1080p30 com o código compactado: H.264 High, 30 fps, quadro-chave a cada 2 s.
- **App da câmera compactado:** abre a câmera, a barra de ajustes e o timecode sem erros.
- **Licença:** vale no computador certo; em outro computador é recusada, e a tela mostra o código deste computador.

### O que ainda depende de você
- **O repositório do GitHub está público.** Enquanto estiver, qualquer pessoa vê todo o código-fonte original.
  - Torne-o **privado** (Settings → General → Danger Zone → Change visibility).
  - Os links de download e a página da câmera precisam então de um repositório público só de distribuição, sem o código. Posso configurar isso.
- **Ligar o licenciamento.** Ainda está desligado: falta instalar a chave pública. Gere as chaves no seu computador com `node tools/licenca.cjs chaves` e mande para o repositório só o `license-public.pem`. A chave privada nunca deve ir para o GitHub nem para o chat.
- **Limite honesto.** Nenhum programa instalado no computador do cliente é impossível de copiar. Estas camadas tornam a cópia difícil, demorada e ilegal; a licença por computador garante que a cópia não funciona sem pagar.
