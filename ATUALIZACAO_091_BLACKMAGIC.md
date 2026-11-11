# Andromeda Live 0.9.1 — recuperação da entrada Blackmagic

Correção: a entrada RTMP reinicia o receptor quando já recebeu vídeo e fica 15 segundos sem entregar novos quadros, mesmo que o processo FFmpeg continue aberto. O canal, porta e chave são preservados durante essa recuperação. O painel mostra o número de recuperações. O intervalo para reabrir o receptor após encerramento foi reduzido de 1,2 s para 0,4 s.

Foi removida a opção de descarte de buffer de entrada do FFmpeg e habilitada geração de timestamps. Isso favorece a recepção e pode aumentar a latência de entrada; deve ser medido no equipamento real.

Não se trata de garantia contra quedas da rede/celular. Se o Blackmagic Camera não tentar reconectar sozinho, será preciso parar e iniciar o Live Stream no aplicativo. Nenhum sinal falso substitui o vídeo perdido.

## Instalação
Fora de uma transmissão, feche a mesa e a janela do servidor. Guarde a pasta anterior e extraia esta versão em outra pasta. Execute INSTALAR.bat e INICIAR.bat. Na mesa, ative a entrada Blackmagic no canal desejado. Copie novamente servidor e chave para o celular: reiniciar o serviço gera uma nova chave. Se usar XML, exporte novamente. Não misture arquivos antigos e novos.

## Validação
22 testes da suíte passaram, incluindo oito entradas RTMP simultâneas, áudio PCM e recuperação com processo simulado. Um teste adicional usa publicação RTMP real do FFmpeg, interrompe e reconecta ao mesmo canal e chave. Não houve acesso ao celular do usuário nem reprodução da falha física informada.

Para investigar se persistir: informe o tempo até a queda, se o Blackmagic continua indicando transmissão, se áudio e vídeo caem juntos, resolução/fps/bitrate, rede utilizada e mensagem do painel da entrada.
