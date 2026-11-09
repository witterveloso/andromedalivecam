# Andromeda Live 0.7 — operação e efeitos

## Instalação
Feche a versão anterior. Extraia o ZIP em uma pasta nova. Execute INSTALAR.bat e INICIAR.bat e abra localhost:3180. Atualize com Ctrl+F5. Reconfigure as conexões/convites após reiniciar. O projeto mobile continua incluído, com as limitações de compilação e testes descritas em seu README.

## Prévia que acompanha os ajustes
Em GC e efeitos, deixe marcado “Mostrar elemento em edição, mesmo fora do AR”. Ao clicar ou editar a seção GC, logotipo ou PiP, a prévia mostra esse elemento com os ajustes do rascunho, sem exigir ativação na transmissão. Carregue uma imagem para visualizar o logo e digite texto para visualizar o GC. A base continua sendo a imagem atual do AR.

“Ativar ao aplicar” continua determinando se o elemento irá ao programa ao clicar Aplicar. A prévia e o AR são separados; inspecionar um elemento não o coloca no ar. Desmarcar a inspeção mostra somente os elementos ativados no rascunho.

## PiP independente — KEY 1
O PiP é uma camada de vídeo contínuo, não um frame congelado ou uma animação de keyframes. Selecione sua fonte na seção PiP e aplique com a janela ativada. A fonte passa a ser reservada ao KEY 1 e não pode ser escolhida para o Preview enquanto o PiP estiver ativo. Se ela estava no Preview, a mesa seleciona outra fonte disponível no limite configurado. A câmera permanece recebendo vídeo e áudio; não é desligada.

O painel KEY 1 na operação mostra a fonte reservada. Cortar outras fontes não muda a câmera do PiP. “Retirar PiP / liberar câmera” remove a janela e devolve a fonte à seleção do Preview. Se o PiP for ativado enquanto sua fonte já ocupa o programa principal, ela pode aparecer tanto na base quanto na janela até o próximo corte; a imagem principal não é cortada automaticamente. O tally Andromeda Cam também considera a câmera presente no PiP como PROGRAM, desde que tenha sinal.

Proporções: 16:9, 4:3, 1:1 e 9:16. Ao escolher formato mais estreito, o enquadramento muda para “Preencher com recorte”, cortando a imagem centralmente. “Mostrar imagem inteira” preserva todo o conteúdo, com barras quando necessário. O recorte não estica a imagem. O PiP utiliza as dimensões originais da mídia recebida. O tamanho é limitado para a janela caber na composição, especialmente em 9:16. Posição e fonte são independentes do Preview. O áudio segue os controles OFF/AFV/ON do mixer; use ON se quiser áudio contínuo da câmera PiP fora do programa principal.

## Mixer e controles
Botões, campos, seletores, sliders com valores numéricos, foco de teclado e estados ativos receberam um novo acabamento visual. Os medidores mostram pico de amostra em dBFS, escala logarítmica de −60 a 0, com retenção de pico por 1 segundo. As cores adotadas são verde abaixo de −18, amarelo de −18 a −6, vermelho de −6 a 0. “PEAK” acende se a amostra atinge o limite digital. Essas faixas são convenções desta interface, não uma certificação broadcast, um medidor true-peak ou LUFS. A leitura numérica antiga do master permanece RMS, identificada pelo tooltip; as barras e suas legendas numéricas são de pico.

Não há níveis de áudio inventados: sem áudio/amostras, o indicador fica no mínimo. Ative o mixer para obter leitura e áudio. OFF silencia, AFV acompanha a base do programa, ON mantém áudio contínuo.

## DTV / intercom
- Segurar para falar: pressionar abre, soltar fecha; perder foco também fecha.
- Fixo: clique liga; outro clique desliga. O botão fica vermelho e informa DTV ABERTO. O áudio continua ao mudar o foco da janela enquanto o navegador mantiver a captura.
- Esc desliga em ambos os modos. Trocar destinatário ou modo, perder a conexão de sinalização e fechar a página desligam a fala. Voltar a conectar não reabre um microfone desligado.
- O retorno do DTV continua separado da saída de programa. Use fones para evitar vazamento acústico.

## Validação
17 testes de backend/composição passaram, incluindo proporções do PiP e tally da fonte KEY. Testes DOM com APIs simuladas verificaram inspeção sem ativar AR, aplicação/remoção de efeitos, reserva e liberação da fonte após cortes, modos de intercom, perda de foco e conversão de amostras para dBFS. Não houve inspeção visual em navegador gráfico nem teste de intercom em aparelhos nesta atualização. A configuração pública de HTTPS/TURN e o link externo de câmera continuam dependendo da infraestrutura descrita no guia 0.6; esta atualização não publica esse serviço.

Referências de interação: ATEM Software Control, key DVE/PiP (https://www.blackmagicdesign.com/products/atemmini/gettingstarted); OBS, mixer e escala de áudio (https://obsproject.com/kb/audio-mixer-guide e https://obsproject.com/kb/audio-mixer-technical-details). As referências orientam o desenho, sem reproduzir marca ou afirmar compatibilidade com equipamentos desses fabricantes.
