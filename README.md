# Andromeda Live + Andromeda Cam

Pacote para GitHub: mesa local Windows, câmera por convite no navegador, gateway público HTTPS/WebSocket e servidor TURN. Um mesmo convite pode ser aberto usando Wi-Fi, 4G ou 5G, sem Tailscale no celular. A pessoa autoriza câmera/microfone e toca em Ativar câmera. Conexão depende do navegador e da rede; mudanças de rede podem interromper a imagem.

**Estado: pronto para subir ao repositório e implantar para homologação. Nenhum servidor público foi provisionado por este pacote.**

## Comece aqui

1. Extraia o ZIP e envie seu conteúdo à raiz do repositório `andromeda-cam`, branch `main`. Não envie apenas o ZIP. Inclua a pasta `.github`.
2. Siga [PUBLICAR.md](PUBLICAR.md). O caminho principal hospeda câmera e gateway no mesmo VPS, com HTTPS automático. GitHub Pages é opcional.
3. Execute o teste de aceitação em [HOMOLOGACAO.md](HOMOLOGACAO.md) antes de uma transmissão.

## O que está incluído

| Pasta/arquivo | Função |
|---|---|
| `public/cam/` | Câmera web, captura, tally e intercom |
| `docs/` | Versão da câmera para GitHub Pages |
| `camera-hub.cjs`, `cloud-server.cjs` | Convites por canal, perfil, sinalização e credenciais temporárias TURN |
| `cloud-client.cjs` | Conexão de saída da mesa local ao gateway público |
| `cloud/` | Docker, Caddy HTTPS, coturn, configuração e instalação |
| `server.cjs`, `public/` | Mesa e integração de áudio/vídeo/encoder |
| `.github/workflows/` | Testes e publicação opcional no Pages |
| `test/` | Testes automatizados |
| `scripts/check-gateway.cjs` | Diagnóstico público de HTTPS/saúde |

## Arquitetura

O gateway valida convites e encaminha negociação WebRTC e tally. A câmera envia vídeo e áudio para a mesa diretamente quando possível; o coturn retransmite quando necessário. O intercom usa uma conexão WebRTC separada e não deve entrar no áudio da transmissão. O corte, a composição do PROGRAM e a codificação continuam no computador da mesa. A chave do YouTube fica na operação da mesa, não no celular.

Cada canal CAM 1–10 tem um convite individual, válido por 12 horas, revogável. Um novo convite invalida o anterior daquele canal. Reiniciar o gateway apaga convites em memória: gere novos links. Uma mesa por gateway; esta entrega não é um SaaS multiempresa.

## Desenvolvimento

Node.js 22+, Python 3 e FFmpeg para os testes de mídia:

```sh
npm ci
npm test
python3 -m unittest discover -s test -p '*_test.py'
```

`npm start` inicia a mesa local. Para a nuvem use `INICIAR_NUVEM.bat` com o arquivo privado `mesa-cloud.env` na raiz. Os guias anteriores continuam no pacote para recursos de GC, PiP, mixer e Blackmagic.

## Segredos e limites

Nunca envie `.env`, `mesa-cloud.env`, `turnserver.conf`, chaves YouTube ou convites reais ao GitHub. Os scripts geram segredos no servidor, com permissões restritas. `.gitignore` e `.dockerignore` excluem esses arquivos.

A configuração TURN entregue usa UDP/TCP 3478. Redes que só permitem TLS 443 podem impedir a chamada; TURN/TLS 443 não está incluído nesta configuração. A transmissão requer manter a página ativa e o celular desbloqueado. Não há bonding de operadoras, garantia de 4K ou controle de todas as lentes físicas no navegador. A capacidade de dez canais deve ser medida no hardware e na banda reais.
