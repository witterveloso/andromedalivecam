# Simulação de 4G/5G (rede de verdade, sem celular)

Monta, no Linux, uma internet simulada com namespaces de rede:
- a **mesa** atrás de um roteador doméstico (NAT);
- o **celular** atrás de um CGNAT de operadora (NAT simétrico, como no 4G/5G);
- na "internet", o ponto de encontro e a página do Andrômeda Cam (HTTPS).

Roda o serviço real da mesa, a mesa no Chromium e o app da câmera no Chromium. O app abre o convite gerado pela mesa, e a simulação mede se o vídeo chegou e por qual caminho.

Precisa de root, `iproute2`, `iptables` e o Playwright com Chromium.

| Comando | Cenário | Resultado esperado |
|---|---|---|
| `sudo ./scenario.sh semupnp` | 5G, roteador sem UPnP | vídeo **não** chega; a mesa e o celular explicam o motivo |
| `sudo ./scenario.sh upnp` | 5G, roteador com UPnP (abre a porta 3478) | vídeo chega pela retransmissão da mesa |
| `sudo ./wifi.sh` | celular no mesmo Wi-Fi da mesa | vídeo chega direto |
| `sudo TURN_SECRET=… ANDROMEDA_TURN_SECRET=… ANDROMEDA_TURN_URLS="turn:203.0.113.5:3478?transport=udp,turn:203.0.113.5:3478?transport=tcp" ./scenario.sh empresa` | 5G, servidor da Rede Andrômeda | vídeo chega pelo servidor da empresa |
