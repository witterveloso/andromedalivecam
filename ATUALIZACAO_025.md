# Andrômeda Live 0.25 — TRACKING com movimento de câmera profissional

## 0.25.0
O tracking passou a se mover **como um operador de câmera**: sem trancos, sem saltos e sem "respirar". O movimento foi refeito com as técnicas das câmeras de rastreio do mercado (PTZ com auto tracking, OBSBOT, Insta360 Link) e o app da câmera ganhou a suavização que faltava no celular.

### O que mudou no movimento
- **Movimento separado da análise.** Antes, a câmera dava um passo a cada detecção (3 a 10 por segundo) e o celular obedecia na hora, o que fazia o enquadramento andar aos pulos. Agora a análise só alimenta um **filtro de Kalman** (posição e velocidade do alvo) e um **laço de movimento a 25 por segundo** conduz a câmera pelo caminho do alvo, também entre uma detecção e outra.
- **Antecipação.** A câmera mira onde o alvo **estará** (pela velocidade estimada), não onde ele estava, e compensa o **atraso da rede** (escolha *Rede da câmera*: Wi-Fi local, Internet ou Internet lenta). O alvo é medido no **quadro inteiro do sensor**, não na janela, para a câmera não confundir o próprio movimento com o da pessoa.
- **Zona de conforto com histerese** (*Pequena / Média / Grande*, desenhada em tracejado no preview): enquanto o alvo está dentro dela a câmera **fica parada**; ao sair, ela vai até ele e só para quando ele está bem centrado. Sem corrigir detalhes a toda hora.
- **Mola amortecida com limites de velocidade e de aceleração:** a câmera **parte e para suavemente** (curva em S), sem passar do ponto. O **zoom** segue o mesmo princípio, em escala logarítmica, e **mantém o centro da imagem** (o zoom não empurra o alvo para o lado).
- **Estilos de movimento:** *Suave (cinema)*, *Normal* e *Rápida (esporte)*.
- **Suavização no celular (app da câmera):** os comandos de tracking levam o tempo de suavização (70 a 140 ms) e o celular **anda até a posição a cada quadro de vídeo**, sem degraus entre um comando e outro. Mexer à mão continua obedecendo na hora. O celular carrega a página nova ao abrir o app da câmera.

### Resultados (simulação com o mesmo cálculo de recorte do app, 3 qualidades de rede, reconhecimento de rosto real)
| | Antes | Agora |
|---|---|---|
| Aceleração máxima da janela | ~90–150 | ~3–6 |
| Solavanco (jerk) | ~1000–2100 | ~45–95 |
| Velocidade máxima da janela | 1,2–2,3 quadros/s | 0,2–0,3 quadros/s |
| Erro médio de posição | 0,09–0,15 | 0,07–0,08 |
| Alvo fora do quadro | 0% | 0% |
No teste com navegador real e o reconhecimento de verdade, o passo máximo da janela a cada 50 ms ficou em 0,007 (quadro inteiro), sem nenhum tranco.

### Referências
Zona morta (dead zone) e feed-forward de velocidade em controle de PTZ; Kalman com a velocidade estimada para prever e compensar atraso; modos de movimento (padrão / "motion") e auto zoom do OBSBOT; velocidade e áreas de rastreio do Insta360 Link; enquadramento suave do Logitech RightSight. Os ajustes numéricos são nossos e foram validados por simulação, não são copiados de nenhum fabricante.

### Limites
Testado com celular simulado (mesma geometria do app) e com o reconhecimento real; o resultado no **celular físico** depende da rede: se o movimento parecer "atrasado", escolha **Rede da câmera = Internet lenta**; se parecer "arrastado", escolha **Rápida** ou zona de conforto **Pequena**.
