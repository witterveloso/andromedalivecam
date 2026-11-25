# Andrômeda Live 0.28 — transmissão profissional em 1080p30, conforme as diretrizes das plataformas

## 0.28.1 — nenhum quadro do PGM perdido no caminho até o codificador
- **O que o registro da live de 7,8 h mostrou** (25/11, 01:30 às 09:20, ainda na versão 0.27.5, em 540p):
  - **Estabilidade:** a saída ficou 7 h 50 min no ar sem interrupção e sem reconexão. Foram 846.891 quadros codificados a 30 por segundo durante todo o tempo, com o codificador a ~7 ms por quadro, áudio contínuo (50 pacotes/s), só 10 quadros descartados pelo codificador e nenhum erro.
  - **Perda na fila:** a mesa compunha o PGM a **29,1 quadros por segundo**, mas só **26 chegavam novos** ao codificador. Os outros 3 eram descartados na fila de entrega: 77.343 quadros na sessão, cerca de 9%. Para manter os 30 por segundo, o codificador repetia o quadro anterior (12,4% de repetidos).
- **Causa:** a captura do PGM entrega os quadros em rajadas, 2 ou 3 de uma vez, e depois fica um vão. A fila tinha lugar para 2: numa rajada de 3, um quadro era jogado fora, e no vão seguinte faltava quadro novo.
- **Correção:** a fila passa a ter lugar para **4 quadros** (até ~133 ms, irrelevante perto dos 2 a 5 s de atraso das plataformas). Em simulação com rajadas de 3, a entrega sobe de **19,6 para 28,6 quadros novos por segundo**, sem nenhum descarte. Um teste automático novo reprova a versão se a fila voltar a perder quadros em rajada.

## 0.28.0 — regra 1080p30, conformidade técnica e envio multiplataforma
- **Regra: só 1080p (ou 4K) a 30 fps.**
  - A transmissão nunca sai abaixo de 1920×1080 a 30 quadros por segundo constantes.
  - Saíram o perfil *Adaptativo* e todas as reduções automáticas para 720p e 540p: no teste antes da live, no teste da saída dedicada e no regulador durante a live.
  - **Computador no limite:** a saída continua em 1080p a 30 fps (o codificador repete o último quadro quando falta um novo) e a mesa entra em modo leve.
  - **Codificador sem capacidade:** se o codificador do computador não produz 1080p a 30 quadros por segundo, a transmissão não abre e a mesa explica o motivo.
  - **Saída vertical (Instagram e TikTok):** agora 1080×1920.
  - **Bitrate:** mínimo de 6 Mbps em 1080p.
  - O serviço local aplica a mesma regra, mesmo que receba outra configuração.
- **Conformidade técnica na página Transmissão.** Antes de entrar no ar, a mesa mostra item por item o que vai entregar:
  - vídeo 1920×1080 a 30 fps;
  - H.264 High@4.1 em bitrate constante, quadro-chave a cada 2 s;
  - áudio AAC-LC 48 kHz estéreo;
  - a saída 16:9 e a 9:16, com o bitrate de cada uma;
  - cada destino com RTMPS (criptografado) ou um aviso se estiver em rtmp://;
  - o upload necessário.
- **Bitrate dentro do limite de cada plataforma.** Uma codificação vai para todos os destinos do mesmo formato. Com Facebook, Twitch, LinkedIn, Instagram ou TikTok ligados, o bitrate fica em 6 Mbps; com Kick, em 8 Mbps. O ajuste é feito sozinho e avisado.
- **Twitch por RTMPS** (`rtmps://live.twitch.tv:443/app`).
- **H.264 High@4.1 em 1080p30.** É o nível pedido pela Meta/Facebook; o 4.0 fica de reserva para codificadores que não aceitam o 4.1.
- **Identificação do software.** Cada destino recebe `flashVer = AndromedaLive/<versão>`, como pede o programa YouTube Live Verified.
- **Painel ao vivo a um clique.** Cada destino tem o link “Abrir o painel ao vivo” (YouTube Studio, Facebook Live Producer, Twitch, LinkedIn e Kick), para conferir a saúde do stream e a latência.
- **Prova técnica a cada versão.**
  - O ensaio real de transmissão no Windows mede o que a plataforma recebe: H.264 High 1920×1080 30 fps, AAC-LC 48 kHz estéreo e quadro-chave a cada 2 s, no máximo 2,1 s.
  - O ensaio reprova a versão se houver qualquer erro de JavaScript na mesa durante o envio.
  - Detalhes em `CONFORMIDADE.md`.
- **Correção encontrada pela auditoria:** durante esta mudança, o regulador de carga chegou a ficar sem as variáveis de contagem (erro “over is not defined”). O ensaio real pegou o erro antes de virar versão, e agora qualquer erro desse tipo reprova o ensaio.
- **LOOP na Trilha** (antes previsto para a 0.27.8):
  - O botão **↻ LOOP** no painel da Trilha repete a música atual sem parar, sem troca nem fade entre as voltas.
  - Vale na hora, com a trilha no ar, e fica salvo.
  - O botão TRILHA nos Comandos mostra **↻** quando o LOOP está ligado.
