#!/bin/bash
# Celular no mesmo Wi-Fi da mesa: o "phone" sai do CGNAT e entra na rede da casa (192.168.1.20).
D=$(cd $(dirname $0) && pwd); $D/net.sh >/dev/null
ip -n phone link del p0
ip -n rdesk link add lan0 type bridge; ip -n rdesk link set lan0 up
ip -n rdesk addr del 192.168.1.1/24 dev l0; ip -n rdesk link set l0 master lan0; ip -n rdesk addr add 192.168.1.1/24 dev lan0
ip link add l2 netns rdesk type veth peer name p0 netns phone; ip -n rdesk link set l2 master lan0; ip -n rdesk link set l2 up
ip -n phone addr add 192.168.1.20/24 dev p0; ip -n phone link set p0 up; ip -n phone route add default via 192.168.1.1
ip netns exec rdesk iptables -t nat -F; ip netns exec rdesk iptables -t nat -A POSTROUTING -o w0 -j MASQUERADE
$D/run.sh wifi
