# Validação da saída de vídeo — candidata beta.14

Esta revisão ainda não é uma versão aprovada para produção. O instalador só deve ser entregue após a aprovação dos testes de transmissão.

## Evidência do diagnóstico recebido

Arquivo: `andromeda-auditoria-2026-11-21T12-24-24.jsonl`, produzido pela beta.11 em Windows, 8 processadores lógicos e 8 GB de memória.

Antes de iniciar o envio, a composição PGM ficou em torno de 29–30 fps. Durante as tentativas de transmissão em WebM, a tela principal chegou a ficar 4.589 ms sem responder. O serviço encerrou cinco tentativas por ausência de vídeo recebido. Houve queda para 1,9 fps e arquivos vazios. Algumas tentativas ativaram gravações horizontal e vertical em Full HD; houve falha também sem gravação.

Esses registros localizam o bloqueio antes do YouTube. Não identificam sozinhos o componente físico responsável nem provam que a placa de vídeo seja insuficiente.

## Alterações

- Interface recuperada do pacote beta.13, para preservar as mudanças do operador.
- Câmera e envio WebRTC limitados a 30 fps; convites antigos com 60 fps são normalizados.
- H.264 e Opus em Worker no perfil fixo. O serviço copia o vídeo H.264 para os destinos e a gravação do mesmo formato; converte apenas o áudio para AAC.
- Fila limitada a dois quadros entre captura e codificação, para absorver diferenças de fase dos relógios sem uma fila crescente de vídeo antigo.
- Métricas distintas para composição, quadros submetidos, quadros efetivamente codificados e composições repetidas. Composição nova não é garantia de quadro novo recebido da câmera.
- Teste da mesma saída dedicada antes de abrir os destinos. Reprova quando a média dos últimos três intervalos não chega a 28,5 quadros codificados e novas composições por segundo. É uma verificação curta, não uma garantia de desempenho contínuo.
- Perfil fixo interrompe com diagnóstico se o motor falhar; não muda silenciosamente para dupla codificação.
- Cancelamento durante inicialização e liberação dos quadros retidos corrigidos.
- Novas configurações gravam apenas o formato horizontal; escolhas já salvas são preservadas.

## Critério de aceitação automatizado

Windows/Electron real, três vídeos locais Full HD em movimento, créditos sobrepostos, cortes, áudio sintético, transmissão RTMP para receptor local e gravação simultânea. Duas sessões consecutivas para verificar início, encerramento e reinício. O teste decodifica os arquivos e compara dimensões, quadros, movimento, timestamps e presença de áudio.

Os testes de serviço, interface e empacotamento continuam separados desse teste com vídeo. A aprovação dos testes unitários não comprova transmissão fluida.

## Limites

O teste local não certifica o computador do operador, câmeras por Wi-Fi/5G, upload, YouTube ou uma transmissão prolongada. A saída 4K ainda não está habilitada nesta candidata; a prioridade desta revisão é concluir a validação de 1080p30. O ajuste de nível H.264 para 4K no núcleo não equivale a uma entrega 4K pronta.
