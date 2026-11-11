# Validação da versão 0.12

## Automática (CI do GitHub, a cada push)

- **Ubuntu e Windows:** 37 testes do serviço, incluindo envio real para dois servidores RTMP locais (um fora do ar) com gravação em MP4 e trilha de auditoria; licença (assinatura, vencimento, bloqueio); convites, sinalização e TURN; entradas RTMP; composição.
- **Mesa em DOM emulado:** carregamento de todos os scripts, layout padrão, T-bar nos dois sentidos, bloqueio durante AUTO, salvar e restaurar layout.
- **Gateway:** testes da configuração (Python), `docker compose config`, construção da imagem e `/health` respondendo no contêiner.
- **Windows:** instalador gerado e programa empacotado aberto na máquina da CI, conferindo mesa, serviço, FFmpeg dentro do pacote e MediaRecorder. O instalador e uma captura da tela ficam como artefato.

## Manual, nesta revisão

- Navegador (Chromium) com câmeras simuladas: quatro fontes, quatro monitores, mosaico no ar com tally e AFV, envio para dois destinos mais gravação, parada, diagnóstico, sem erros de página.
- Programa Electron empacotado (Linux), com e sem `mesa-cloud.env`.
- Ponta a ponta da câmera por convite (0.11): QR code, celular simulado conectando, vídeo na mesa, PREVIEW → NO AR, revogação.

## Ainda não validado

- Plataformas reais com as chaves de cada conta.
- Computador de produção, live longa, HD externo real, codificador por GPU.
- Celulares físicos (iPhone e Android) em Wi-Fi e 4G/5G, TURN em produção, áudio e intercom com fones.
- Instalação do programa em um Windows de usuário (o da CI é uma máquina de servidor) e o aviso do SmartScreen sem assinatura digital.

Siga [HOMOLOGACAO.md](HOMOLOGACAO.md) antes de uma live com público.
