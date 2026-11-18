# Andrômeda Live 0.24 — TRACKING: a câmera segue a pessoa

## 0.24.3
- **PRÓXIMO SLIDE e SLIDE ANTERIOR agora sempre dão resposta.** Antes, com a apresentação fora do PREVIEW e do AR, o slide mudava só dentro do painel e parecia que o comando não funcionava; agora, se os slides não estão no **PREVIEW nem no AR**, o comando os leva ao **PREVIEW** (sem atrapalhar uma transição em andamento) e passa o slide. Sem apresentação aberta, o comando **avisa na barra de eventos** e leva ao painel Slides, em vez de ficar mudo. O mesmo vale para os atalhos PageDown/PageUp, primeiro/último slide, "Ir para o slide" e o controle remoto.
- **A mesa recebe qualquer arquivo de apresentação:**
  - **Soltar o arquivo em qualquer lugar da mesa** abre nos Slides (apresentações e imagens), e **pastas** de imagens são percorridas. Vídeos e músicas soltos fora do lugar são ignorados com um aviso, e a mesa **nunca mais "abre" o arquivo no lugar do programa**.
  - O leitor embutido de PPTX ficou **tolerante**: um item que ele não entende (forma exótica, imagem em formato não suportado) é pulado e o resto do slide aparece. Testado com PPTX do PowerPoint, do LibreOffice e com os 11 modelos de layout do PowerPoint.
  - Se o computador não tinha conversor quando o programa abriu e você **instala o LibreOffice depois**, a mesa percebe sozinha no próximo arquivo (não precisa reiniciar).
  - O PowerPoint também converte **ODP/OTP**.
  - **Mensagens claras** para arquivo danificado, vazio, protegido por senha, formato desconhecido ou sem conversor, sempre com o caminho de saída (exportar em PDF ou instalar o LibreOffice).

## 0.24.2
- **Instalador pronto para ser assinado (some o aviso "O Windows protegeu o computador").** O aviso do SmartScreen só desaparece quando o instalador é **assinado por um certificado de assinatura de código** e ganha reputação com o uso; isso depende de uma credencial que só o dono do produto pode contratar (identidade e pagamento). A partir desta versão o CI **assina o instalador, o desinstalador e o programa** assim que as credenciais forem cadastradas no GitHub (Azure Artifact Signing ou certificado), **confere se a assinatura ficou válida** e **não publica** se ficou inválida. O passo a passo está em [ASSINATURA.md](ASSINATURA.md). Sem credenciais nada muda: o instalador sai como antes.
- **`SHA256SUMS.txt` em cada versão** para conferir se o arquivo baixado é o original (`certutil -hashfile <arquivo> SHA256`).
- **Enquanto não há certificado:** no aviso, clique em **Mais informações** e depois em **Executar assim mesmo**.

## 0.24.1
- **Áudio master com visual novo.** O painel foi reorganizado: o **estado do áudio** (sinal, silêncio, pico) virou um indicador com LED no topo, com o atalho **⇄ Remoto** para a mesa de áudio em outro aparelho; **ÁUDIO HABILITADO** e **FONES** ficam lado a lado, com o texto inteiro; os medidores **L e R** são barras horizontais em **LED** (verde, amarelo e vermelho) com a leitura em dBFS e o aviso PEAK ao lado e a escala embaixo; o **volume** tem leitura grande em dB e barra de largura total; o **FADE OUT** é um botão grande, com o tempo ao lado. Tudo cabe no tamanho padrão do painel, sem rolagem, inclusive em janelas pequenas, e segue o estilo de botões escolhido (Vidro, Neon, Console…).

## 0.24.0
- **Tracking no Controle de câmera.** Na coluna do preview, ao lado da imagem, o botão **⌖ Tracking** liga o seguimento automático da câmera escolhida: a mesa vê a imagem do celular, acha o alvo e manda ao celular o **pan e o zoom** que o mantêm no quadro, como um operador de câmera. Nasce **desligado** em cada câmera e só liga com o Controle de câmera ativo e o celular conectado.
- **O que seguir:** **Rosto**, **Pessoa (corpo)** ou **Movimento** (o que se mexe na imagem). O reconhecimento roda **neste computador**, dentro do programa (MediaPipe, sem internet e sem enviar imagem a ninguém).
- **Enquadramento automático:** **Só seguir** (não mexe no zoom), **Rosto (close)**, **Busto**, **Meio corpo** ou **Corpo inteiro**: o zoom é ajustado devagar até a pessoa ficar no tamanho escolhido, respeitando os limites do aparelho. O rosto fica na linha do terço superior do quadro.
- **Velocidade** Suave, Normal ou Rápida, e **Se perder o alvo**: manter a posição ou voltar ao centro.
- **Vários alvos:** segue o maior e continua no mesmo (o mais próximo do anterior); **clique numa pessoa no preview** (ou em *Escolher outro alvo*) para trocar. O preview mostra as caixas dos alvos, o **ALVO** em vermelho e a mira.
- **Operar à mão tem prioridade:** mexer no pan, no zoom, na lente, na exposição ou numa posição salva **pausa o tracking por 4 s** e ele volta a seguir. Desligando, a câmera fica onde está e nada mais é enviado.
- **Como funciona o "andar":** o celular não gira; ele move um **recorte digital**. Por isso o tracking precisa de **zoom acima de 1×** para ter folga (no modo *Só seguir* ele aplica 1,4× ao ligar). No limite do recorte a mesa avisa para reduzir o zoom. Com a câmera em zoom ótico/nativo e movimento físico (gimbal) seria preciso um acessório; esta versão usa o recorte digital do Andromeda Cam.
- **Atalho:** a ação *TRACKING da câmera selecionada* aparece em *Personalizar → Atalhos do teclado* (sem tecla por padrão).
- Consumo: o reconhecimento de rosto é leve; o de corpo inteiro pesa mais. A mesa ajusta sozinha a frequência da análise (de 2 a 10 por segundo) para não atrapalhar a transmissão.
- O programa fica ~25 MB maior por levar os modelos de reconhecimento.
