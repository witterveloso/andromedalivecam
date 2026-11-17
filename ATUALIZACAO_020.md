# Andrômeda Live 0.20 — motor de transmissão: sincronismo automático, pré-voo, autorrecuperação e mesa mais leve

Esta versão trata da estabilidade da transmissão em **computadores e notebooks comuns**: o que faz o envio falhar, travar ou sair dessincronizado.

## O que mudou

### 1. Sincronismo de som e imagem (lip sync) automático
Em **Transmissão → Codificador → Sincronismo de som e imagem**.

- **Calibrar automaticamente** (cerca de 15 s): a mesa passa pela cadeia real de envio um sinal de teste, tela preta com clarões brancos e, no mesmo instante, um bipe de 1 kHz. O serviço grava, mede a diferença entre o clarão e o bipe no arquivo, apaga o arquivo e devolve o resultado.
  - A calibração **não coloca a mesa no ar** e não toca em nenhuma plataforma. Durante os 15 s a saída do AR mostra os clarões, então faça antes de entrar no ar.
- A **compensação** (de −500 a +500 ms) é aplicada no codificador em **toda transmissão e gravação**: se o som chega atrasado, atrasa a imagem; se chega adiantado, atrasa o som.
- **Margem de tolerância:** abaixo de 40 ms a mesa não corrige nada. A imagem tem resolução de um quadro (cerca de 33 ms), então diferenças menores são ruído de medição, e o olho só percebe diferenças maiores que cerca de 45 ms (ITU-R BT.1359).
- **Ajuste fino** de −300 a +300 ms, e botão **Zerar**. Vale a partir da próxima transmissão.
- **Limite:** o teste mede o caminho do programa (imagem e mixer). A latência do microfone e da placa de áudio do operador não entra no teste. Para isso serve o ajuste fino.

### 2. Pré-voo e perfil automático ("Este computador")
Em **Transmissão → Codificador → Este computador**.

- **Verificar e ajustar automaticamente:** a mesa codifica um sinal de teste com os mesmos parâmetros da transmissão, mede quantas vezes mais rápido que o tempo real o computador roda e escolhe sozinha a **melhor opção que deixa o codificador usando no máximo 30% do computador**. O resto fica para o navegador (que desenha a mesa e faz o primeiro trecho da codificação), o sistema e picos.
  - Escada de opções: 1080p equilibrado → 1080p rápido → 720p equilibrado → 720p rápido → 720p máximo desempenho.
  - Se a saída vertical (9:16) também for usada, as duas saídas dividem esse orçamento.
  - Se nem a opção mais leve couber e houver um codificador de placa de vídeo (NVIDIA, Intel ou AMD), a mesa passa a usá-lo.
  - Se nada resolver, ela avisa que o computador está no limite e o que fazer.
- **Velocidade do codificador** (Equilibrado / Rápido / Máximo desempenho): dá para trocar à mão. Mais rápido = menos CPU e um pouco menos de qualidade por bitrate.
- **Ao iniciar a transmissão**, a mesa confere se o servidor de cada plataforma responde a partir deste computador (conexão na mesma porta que a live vai usar).
  - Se nenhum responder, **não inicia**: a live falharia. A mensagem diz qual plataforma e por quê.
  - Se só alguns não responderem, avisa e segue; a mesa reconecta sozinha.
- **Sobrecarga durante a live:** o serviço mede a velocidade real do codificador a cada segundo. Se ele ficar para trás por 8 s, a mesa avisa (uma vez por minuto), registra na auditoria e passa para o **modo leve**: as miniaturas são desenhadas com menos frequência. A saída do AR continua a 30 quadros por segundo.

### 3. Autorrecuperação do codificador
- Se o codificador (FFmpeg) **cair no meio da transmissão ou da gravação**, o serviço o **reinicia sozinho** (até 3 vezes em 2 minutos) e pede ao navegador um gravador novo. A live volta em instantes.
- A gravação **nunca é sobrescrita**: cada reinício grava num arquivo novo (`…_16x9.mp4`, `…_16x9_p2.mp4`, `…_p3`).
- Cada formato (16:9 e 9:16) é independente. Se a quarta queda acontecer em 2 minutos, a mesa desiste com uma mensagem clara em vez de ficar em ciclo.
- O codificador roda com prioridade acima do normal, para o navegador e outros programas não o atrasarem.

### 4. Mesa mais leve (computadores sem placa de vídeo)
- **Miniaturas das câmeras a 10 quadros/s e preview a 15**, em vez de 30, e só quando a página Operação está à vista. Miniaturas ocultas não são mais desenhadas.
- O monitor de efeitos deixou de copiar o AR inteiro (até 1080p) a cada quadro.
- **Medido:** num computador de teste sem placa de vídeo, a saída do AR passou de cerca de **15 para cerca de 24 quadros por segundo**. É o quadro que vai para a plataforma e para a gravação.

### 5. Ajustes no envio
- Pedaços do gravador do navegador a cada 100 ms (antes 250 ms).
- Sondagem de entrada do FFmpeg reduzida (256 KB) e decodificação em modo de baixo atraso.
- Buffer de taxa de bits de 1 s (antes 2 s) e **fila de reenvio de 3 s por destino** (antes 12 s): uma plataforma lenta atrasa no máximo 3 s em vez de acumular atraso, e se a fila encher o FFmpeg descarta pacotes em vez de segurar o codificador.
- Áudio AAC em 48 kHz (já vinha da 0.18.2).

## Sobre o atraso (o que dá e o que não dá para eliminar)
- O **atraso que o público vê** é, em quase toda a sua extensão, da **plataforma** (recebimento, processamento e entrega). Nenhum programa de envio elimina isso. O que controla é o **modo de latência** configurado na própria plataforma (por exemplo, "baixa" ou "ultrabaixa" nas configurações da live do YouTube) e a plataforma escolhida.
- O trecho **da mesa até a saída para a internet** foi medido neste ambiente: cerca de **0,4 a 1,4 s**, com muita variação porque o computador de teste estava saturado. **Não foi possível provar com precisão** o quanto as mudanças do item 5 reduzem esse número neste ambiente. Elas são mudanças conhecidas de redução de buffer, sem efeito colateral medido.
- Testamos e descartamos a flag `-fflags +nobuffer` do FFmpeg: ela faz a imagem só aparecer no quadro-chave seguinte (clarões iniciais perdidos nos ensaios). A decodificação por fatias com 2 threads também foi testada e não mostrou ganho, então não foi adotada.

## O que foi testado
- **Testes automáticos** (70 do serviço, mais verificações de interface):
  - medição de sincronismo contra sinais sintéticos com atraso conhecido (0, +120 e −90 ms);
  - **circuito fechado** com FFmpeg real: sinal alinhado → motor de envio com compensação de 0, +150 e −150 ms → gravação → medição. A diferença medida confere nos dois sentidos;
  - calibração: a pasta temporária é apagada e a plataforma não é tocada;
  - escolha de perfil (computador forte, médio, fraco, com placa de vídeo, com saída vertical), alcance de destinos (aberto, recusado, endereço inválido) e API protegida por token;
  - detecção de sobrecarga com um codificador de mentira: um aviso por minuto, e nenhum em codificador saudável;
  - **autorrecuperação:** o FFmpeg é morto, e a sessão continua com duas partes gravadas e legíveis; um cliente antigo mantém o comportamento anterior; na quarta queda desiste.
- **Navegador real (Chromium) com o serviço real:**
  - calibração pelo botão: 15 s, 8 pares medidos;
  - compensação de 0, +120 e −120 ms pela interface: a medição final no arquivo gravado mudou 126 e 107 ms (resolução de um quadro);
  - "Verificar e ajustar": 1080p equilibrado escolhido;
  - servidor inalcançável recusado com mensagem clara, e alcançável aceito;
  - **FFmpeg morto durante a gravação**: o navegador abriu um gravador novo e saíram duas partes com 107 e 150 quadros.
- **Dois defeitos achados e corrigidos antes de publicar:**
  - o primeiro pedaço do gravador do Chrome tem apenas 1 byte, e o cabeçalho do WebM vem dividido em dois pedaços. A detecção de cabeçalho do reinício foi refeita para funcionar nesse caso;
  - o reinício não reenvia mais a mensagem `ready`, o que faria o navegador chamar `start()` num gravador que já estava gravando.
- **Não testado em PCs Windows reais nem com microfone externo.** No primeiro ensaio de produção, confira:
  1. clique em **Verificar e ajustar automaticamente** no próprio computador da produção;
  2. rode a **calibração** e confirme de ouvido num vídeo de uma pessoa falando;
  3. faça uma live de teste de 30 minutos olhando o aviso de sobrecarga e os números de quadros.
