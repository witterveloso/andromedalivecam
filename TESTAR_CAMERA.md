# Testar o Andromeda Cam sem mesa

Abra a página publicada da câmera com `?teste=1` no fim do endereço, no Safari ou Chrome do celular. Na tela inicial sem convite também há o botão "Testar câmera sem mesa".

Toque em ATIVAR TESTE e permita câmera e microfone. Você vê a imagem real, o nível do microfone, o botão de mudo, as lentes disponíveis e a resolução efetiva. Em Ajustes (ícone no canto superior direito) mude resolução, quadros por segundo e microfone; pare e ative de novo para aplicar. "Ouvir microfone nos fones" liga a escuta local: use fones. PARAR libera câmera e microfone.

É o cliente real em captura local, sem WebSocket nem envio de mídia. O tally permanece TESTE LOCAL · FORA DO AR; intercom, bitrate de envio e convite ficam desabilitados. Isso não comprova transmissão pela rede, retorno do DTV ou recebimento na mesa. Sem `teste=1`, o fluxo normal continua exigindo gateway e convite.

Para atualizar a página publicada, envie `index.html`, `cam.css`, `cam.js`, `manifest.json` e `icon.png` da pasta `docs/` deste pacote para a pasta `docs/` do repositório da câmera e aguarde o workflow "Publish Andromeda Cam".

Validação: os testes automatizados do cliente com captura simulada passam (sem chamadas de rede no modo de teste e com liberação das tracks ao parar). Ainda precisa ser validado em aparelhos reais.
