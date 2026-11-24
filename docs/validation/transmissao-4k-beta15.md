# Saída 4K30 — beta.15

O perfil 4K usa PGM 3840×2160 a 30 quadros/s, H.264 em WebCodecs, áudio Opus no trecho local e conversão para AAC no FFmpeg. O FFmpeg copia o vídeo codificado para RTMP e gravação; cada formato 16:9 é codificado uma vez, mesmo com vários destinos.

## Critério de abertura

Antes de conectar, o aplicativo mede 4,2 segundos da composição do PGM e do codificador. O perfil fixo somente abre a transmissão quando a média dos três últimos segundos apresenta pelo menos 28,5 quadros codificados e 28,5 composições novas por segundo. Se falhar, informa as duas taxas e não reduz a resolução silenciosamente. Durante a live, a saída dedicada encerra em caso de falha em vez de substituir 4K por uma saída de menor resolução.

## Validação

- Testes de configuração cobrem 3840×2160, 30 fps, bitrate de 30 a 60 Mbps, nível H.264 para 4K e o mesmo vídeo codificado para gravação e destinos.
- O teste de integração `ANDROMEDA_TEST_4K=1 npx electron test/transmission-electron.cjs` faz envio para receptor RTMP **local** e gravação simultânea no Windows; verifica resolução, quadros únicos, áudio e médias de quadros do PGM e codificador. A fonte sintética nesse teste é 1080p; ele valida a saída 4K, não a ingestão de uma câmera 4K.
- O runner de CI compartilhado pode não ter codificação 4K adequada. Esse teste gera um diagnóstico independente e não certifica o computador do operador.
- Execução no runner Windows (`45053484934`): **falhou na qualificação**. Codificador 30,7 fps, PGM novo 8,0 fps e composição 8,0 fps. O destino RTMP não foi aberto. O gargalo medido nesse ambiente foi a composição 4K no processo da mesa, não a geração de H.264. A causa precisa ser isolada no computador de operação; não se pode atribuí-la só ao hardware sem medir GPU, CPU e o tempo do desenho.
- Faltam teste com câmeras 4K reais, transmissão longa no equipamento de operação, banda de upload sustentada e confirmação de qualidade no painel do YouTube. Não considerar o perfil apto para produção apenas pelos testes de configuração.

## Teste no equipamento de operação

Selecionar **Transmissão → Perfil de saída → 4K 3840×2160 fixo**, começar em 42 Mbps e verificar o diagnóstico após a qualificação. Fazer um ensaio privado com gravação e envio simultâneos, câmeras e créditos reais por pelo menos 30 minutos. Conferir fps do PGM, fps codificado, quadros descartados, resolução efetiva da gravação e saúde do YouTube. Se a qualificação falhar, o computador ou esta implementação ainda não sustentam 4K30 naquela cena; o erro mostra onde caiu a cadência.
