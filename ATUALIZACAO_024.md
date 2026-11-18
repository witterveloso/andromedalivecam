# Andrômeda Live 0.24 — TRACKING: a câmera segue a pessoa

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
