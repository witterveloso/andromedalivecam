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
13. Multiplataforma: na página Transmissão, ative cada destino que será usado (YouTube, Facebook, Instagram, Twitch, Kick, TikTok, LinkedIn ou RTMP próprio) com as chaves reais e faça uma live privada ou não listada em todos ao mesmo tempo. Confira o player de cada plataforma. Some o bitrate de todos os destinos e confirme que o upload do local sustenta pelo menos 1,3 vez esse total.
14. Queda de destino: durante o ensaio, encerre a live em uma das plataformas. A mesa deve mostrar RECONECTANDO só naquele destino, sem interromper os outros nem a gravação.
15. Gravação: grave no disco interno e em um HD/SSD externo conectado por USB. Confira em Transmissão → Gravação se a unidade aparece, o espaço e as horas disponíveis. Abra o MP4 gerado e confira áudio e vídeo até o fim.
16. Mosaico: coloque duas, três e quatro câmeras no mosaico, incluindo um celular na vertical, e confira o enquadramento no PGM, o tally das câmeras e o áudio AFV.
17. Programa instalado: rode o ensaio longo no Andrômeda Live instalado, com a janela atrás de outros programas por alguns minutos, e confira no Diagnóstico se houve aviso de queda de quadros.
18. Ao final, exporte a auditoria (Diagnóstico → Exportar auditoria) e guarde junto com as anotações do ensaio.

Limites atuais: uma mesa por gateway; convites em memória por 12 horas; sem TURN/TLS 443, sem bonding e sem garantia de captura em segundo plano. Para SaaS comercial multiempresa, ainda são necessários isolamento de clientes, contas, armazenamento de sessões e operação/monitoramento contínuo.
