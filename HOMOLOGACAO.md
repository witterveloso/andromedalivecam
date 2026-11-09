# Aceitação antes de uma live

Este pacote não foi publicado em um servidor real nem testado em celulares físicos durante a preparação. Os testes automatizados cobrem protocolos e processos locais; não substituem o roteiro abaixo.

1. Confirme HTTPS sem alerta de certificado e gateway saudável.
2. Gere CAM 1 e abra em um iPhone/Safari; gere CAM 2 e abra em Android/Chrome. Use o navegador externo quando o WhatsApp não permitir captura.
3. Verifique imagem e áudio reais na mesa. Confira perfil efetivo: o dispositivo pode entregar resolução/fps menores que o solicitado.
4. Faça o teste com celular em Wi-Fi de outra rede e depois em 4G/5G. O link deve ser o mesmo enquanto válido. Tailscale deve estar desligado para validar o caminho público.
5. Confirme pelo diagnóstico WebRTC do navegador/estatísticas do par selecionado que há candidato `relay` em pelo menos um teste. Uma chamada direta bem-sucedida não comprova o TURN. Um técnico pode forçar `iceTransportPolicy: relay` temporariamente nos dois peers para esse ensaio; reverta após o teste.
6. Selecione PREVIEW e corte para AR. Confira tally no celular e se apenas o PROGRAM vai para o encoder.
7. Teste áudio OFF/AFV/ON por canal, medidor L/R do AR e saída gravada. VU se movimentando não confirma sozinho a recepção no YouTube.
8. Teste intercom com fones, pressionar para falar e modo fixado. Grave a saída para garantir que o intercom não vazou no programa.
9. Troque Wi-Fi por 5G, interrompa brevemente a internet e confirme reconexão. Meça o tempo e o comportamento de áudio/tally, sem presumir continuidade perfeita.
10. Revogue o convite: a câmera deve desconectar. Reinicie o gateway: convites antigos não devem funcionar.
11. Suba gradualmente até dez câmeras, monitorando CPU, memória, rede e queda de frames. Só use a quantidade que passou no teste do equipamento real.
12. Faça uma live não listada, confira áudio e vídeo no player do destino e mantenha um ensaio contínuo de pelo menos 30 minutos.

Limites atuais: uma mesa por gateway; convites em memória por 12 horas; sem TURN/TLS 443, sem bonding e sem garantia de captura em segundo plano. Para SaaS comercial multiempresa, ainda são necessários isolamento de clientes, contas, armazenamento de sessões e operação/monitoramento contínuo.
