# Andromeda Live 0.10 — mesa personalizável e T-bar

## Operação

O padrão passa a ser PGM/AR à esquerda e Preview à direita no par de monitores. O medidor estéreo acompanha o monitor PGM. A posição visual não altera a fonte enviada ao encoder: continua sendo apenas o PROGRAM.

O botão Personalizar abre as opções em Configurações. Há 15 painéis: câmeras, PGM, Preview, corte/transições, seleção de fontes, camadas, intercom, mixer, Blackmagic, convites, codificador, destinos, eventos, editor de efeitos e prévia dos efeitos.

Para cada painel, escolha a área (esquerda/direita/abaixo na operação, Configurações, Transmissão ou GC e efeitos), meia largura ou largura total e ordem pelas setas. Editar posições libera arrastar pelo título. Para mover entre abas, use o seletor de área. Ajuste também a proporção entre as colunas da operação. Em telas estreitas a interface empilha os painéis.

As preferências são salvas no navegador. Exportar/Importar layout transporta apenas a disposição, sem senhas ou chaves. Restaurar padrão volta ao layout desta versão. Se trocar navegador, perfil ou endereço de acesso (localhost vs 127.0.0.1), importe o layout salvo. Os ajustes internos dos recursos continuam nos próprios painéis; esta atualização personaliza sua disposição, não cria um editor de cada controle interno.

## Manche de transição

O slider foi substituído por um T-bar vertical inspirado nas alavancas de transição ATEM e vMix. Arraste a alavanca com mouse ou toque: a mistura acompanha o movimento. Soltar mantém o ponto intermediário. Ao alcançar o fim do curso, PGM e Preview trocam uma vez, a alavanca permanece nesse extremo e a próxima transição percorre o sentido contrário.

Teclado com o T-bar em foco: setas ajustam 1%; Page Up/Down ajustam 10%; Home/End vão aos extremos. Durante AUTO o manche fica bloqueado. A barra de espaço no manche não dispara corte acidental; fora dos campos/controles permanece o atalho de operação já existente.

Referências consultadas:
- https://www.blackmagicdesign.com/uk/products/atemtelevisionstudio/gettingstarted
- https://www.vmix.com/help28/FadeBar.html

## Atualização

Fora de uma live, feche a mesa e seu servidor, guarde a pasta antiga, extraia o ZIP em nova pasta e execute INSTALAR.bat e INICIAR.bat. Reconfigure as entradas da sessão; ao reiniciar o serviço, copie a nova chave Blackmagic para o celular. A correção RTMP da versão 0.9.1 está mantida.

## Validação

A suíte Node testa recepção RTMP, reconexão, áudio, codificação, composição e acesso aos novos arquivos pelo servidor. O teste adicional test/workspace-ui.cjs carrega todos os scripts em DOM emulado, confere ordem PGM/Preview, vínculo dos medidores ao PGM, 15 painéis, movimentação/salvamento/restauração, transição parcial, término nos dois sentidos e bloqueio durante AUTO.

Para repetir a validação UI, instale jsdom 31 em um diretório de ferramentas e execute o teste com NODE_PATH apontando para o node_modules desse diretório. Não é uma dependência necessária para operar a mesa. A renderização visual em Chromium não pôde ser validada neste ambiente (bloqueio de sandbox); conferir a aparência e o gesto de toque no equipamento real antes de usar ao vivo.
