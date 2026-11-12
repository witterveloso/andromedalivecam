# Andrômeda Live

Mesa de produção ao vivo para Windows: até 10 câmeras de celular por link de convite (Wi-Fi ou 4G/5G), câmeras Blackmagic por RTMP, mosaico, gráficos, mixer de áudio, gravação em disco ou HD externo e transmissão do PROGRAM para até 6 destinos ao mesmo tempo (YouTube, Facebook, Instagram, Twitch, Kick, TikTok, LinkedIn ou qualquer servidor RTMP).

Versão atual: **0.13**. O que mudou está em [ATUALIZACAO_013.md](ATUALIZACAO_013.md); as decisões de produto, em [AVALIACAO_PRODUTO.md](AVALIACAO_PRODUTO.md).

## As três partes

| Parte | O que é | Onde roda |
| --- | --- | --- |
| **Mesa** (`server.cjs`, `public/`, `desktop/`) | Corte, mosaico, gráficos, áudio, gravação e codificação | Computador da produção (Windows) |
| **Câmera** (`docs/`, `public/cam/`) | Página que o celular abre pelo convite: imagem, tally e intercom | Navegador do celular |
| **Gateway** (`cloud/`, `cloud-server.cjs`, `camera-hub.cjs`) | Convites, sinalização e TURN num servidor próprio | VPS Linux com Docker (opcional) |

## Como os celulares chegam à mesa

Em **Configurações → Convites**, passo 1, escolha o modo. Nenhum deles usa Tailscale.

| Modo | Quando usar | O que precisa |
| --- | --- | --- |
| **Internet** (padrão) | Celular em Wi-Fi, 4G ou 5G, em qualquer lugar | Internet no computador. Nada para configurar |
| **Rede local (IP)** | Celular no mesmo Wi-Fi do computador, inclusive sem internet | Escolher o IP do computador e tocar em "Ativar rede local" |
| **Endereço próprio** | Gateway publicado num VPS (veja [PUBLICAR.md](PUBLICAR.md)) | Endereço HTTPS do gateway |

Em todos os modos a imagem vai direto do celular para o computador (WebRTC). Detalhes, limites e como testar estão em [ATUALIZACAO_013.md](ATUALIZACAO_013.md).

## Instalar a mesa no Windows

**Programa instalado (recomendado).** Baixe `Andromeda-Live-Setup-0.13.0.exe` na página de versões do repositório (**Releases**, à direita na página inicial do GitHub, ou `https://github.com/witterveloso/andromedalivecam/releases/latest`) e instale. A CI publica o instalador ali a cada atualização da `main`. O instalador cria atalhos na área de trabalho e no menu Iniciar e não pede administrador. O programa já traz o serviço local e o FFmpeg: não é preciso instalar Node.js nem manter uma janela de terminal aberta.

O instalador ainda não tem assinatura digital, então o Windows SmartScreen mostra "O Windows protegeu o computador": clique em **Mais informações → Executar assim mesmo**. Para distribuir a clientes, assine com um certificado de assinatura de código (veja [AVALIACAO_PRODUTO.md](AVALIACAO_PRODUTO.md)).

**Versão portátil (sem instalar).** Na mesma página de versões, baixe `Andromeda-Live-0.13.0-portatil-windows.zip`, clique com o botão direito → **Extrair tudo**, abra a pasta extraída e dê dois cliques em **Andromeda Live**. O navegador costuma baixar `.zip` sem a retenção que aplica a programas `.exe`.

**Modo navegador (alternativa).** Com Node.js 22 ou superior: `INSTALAR.bat` e depois `INICIAR.bat`, que abre a mesa no navegador em `http://localhost:3180`. Mantenha a aba visível durante a transmissão.

**Pastas do programa instalado:** logs de auditoria, licença e configuração da nuvem ficam em `%APPDATA%\Andromeda Live\` (cole esse caminho na barra do Explorador de Arquivos).

- `logs\`: uma trilha por sessão, também visível na página Diagnóstico.
- `mesa-cloud.env`: para usar o gateway na nuvem, copie aqui o arquivo gerado no VPS e reabra o programa (no modo navegador, use `INICIAR_NUVEM.bat` com o arquivo na pasta do projeto).
- `licenca.txt`: criado ao ativar uma licença na página Diagnóstico.

## Antes da primeira live

Siga [HOMOLOGACAO.md](HOMOLOGACAO.md): live privada em cada plataforma com as chaves reais, ensaio longo no computador de produção, celulares reais em Wi-Fi e 4G/5G, gravação em HD externo. A CI comprova que o programa instala, abre e passa nos testes em Windows e Linux; ela não substitui o ensaio com o equipamento e as contas reais.

## Desenvolvimento

```sh
npm ci                 # Node.js 22+
npm test               # serviço: codificador, destinos, gravação, câmeras, licença
npm run test:ui        # mesa em DOM emulado
npm run test:python    # configuração do gateway
npm run desktop        # abre a mesa no Electron
npm run dist:win       # gera o instalador (Windows)
```

A CI (`.github/workflows/ci.yml`) roda os testes em Ubuntu e Windows, constrói e inicia o contêiner do gateway, gera o instalador, abre o programa empacotado no Windows e guarda o instalador e uma captura da mesa como artefato. O workflow `pages.yml` publica `docs/` no GitHub Pages a cada push na `main`.

| Pasta ou arquivo | Função |
| --- | --- |
| `server.cjs`, `encoder.cjs`, `receiver*.cjs` | Serviço local: mesa, codificação, destinos, entradas RTMP |
| `storage.cjs`, `audit.cjs`, `license.cjs` | Gravação e unidades, trilha de auditoria, licença |
| `public/` | Interface da mesa |
| `desktop/` | Programa para Windows (Electron) e ícones |
| `docs/`, `public/cam/` | Página da câmera (os mesmos arquivos; só `config.js` muda) |
| `camera-hub.cjs`, `cloud-server.cjs`, `cloud-client.cjs`, `cloud/` | Convites, sinalização, gateway público e TURN |
| `relay.cjs`, `public/cam/relay.js` | Modo Internet: encontro cifrado da mesa com o celular por MQTT/WSS |
| `lan.cjs` | Modo Rede local: HTTPS no IP do computador com certificado próprio |
| `mobile/` | Projeto do aplicativo nativo da câmera (Flutter, experimental) |
| `tools/licenca.cjs` | Gerador de chaves e tokens de ativação (uso do vendedor) |
| `scripts/check-gateway.cjs` | Verificação de HTTPS e saúde do gateway publicado |
| `test/` | Testes automatizados |

Nunca envie ao repositório: `.env`, `mesa-cloud.env`, `cloud/turnserver.conf`, `licenca-privada.pem`, `licenca.txt`.
