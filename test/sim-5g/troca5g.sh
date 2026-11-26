#!/bin/bash
# Celular no 5G (CGNAT), roteador da mesa com UPnP; a mesa troca de "Wi-Fi" (192.168.1.10) para "cabo" (192.168.1.11) no meio da live.
unset HTTPS_PROXY HTTP_PROXY https_proxy http_proxy ALL_PROXY all_proxy NO_PROXY no_proxy
D=$(cd $(dirname $0) && pwd); cd "$D/../.."; rm -f "${D:?}/invite.txt" "${D:?}/done" "${D:?}/trocar"
[ -f $D/cert.pem ] || openssl req -x509 -newkey rsa:2048 -nodes -keyout $D/key.pem -out $D/cert.pem -days 30 -subj "/CN=203.0.113.5" -addext "subjectAltName=IP:203.0.113.5" 2>/dev/null
$D/net.sh >/dev/null
ip -n rdesk link add lan0 type bridge; ip -n rdesk link set lan0 up
ip -n rdesk addr del 192.168.1.1/24 dev l0; ip -n rdesk link set l0 master lan0; ip -n rdesk addr add 192.168.1.1/24 dev lan0
ip link add l3 netns rdesk type veth peer name e0 netns desk; ip -n rdesk link set l3 master lan0; ip -n rdesk link set l3 up
ip netns exec rdesk iptables -t nat -F POSTROUTING; ip netns exec rdesk iptables -t nat -A POSTROUTING -o w0 -j MASQUERADE
ip netns exec rdesk node $D/igd.cjs > $D/igd.log 2>&1 & G=$!; sleep 0.5
ip netns exec inet node $D/inet.cjs > $D/inet.log 2>&1 & I=$!; sleep 1.5
ip netns exec phone node $D/phone.cjs > $D/phone.log 2>&1 & P=$!
( for i in $(seq 1 120); do [ -f $D/trocar ] && break; sleep 0.5; done
  ip -n desk link set d0 down; ip -n desk addr flush dev d0
  ip -n desk addr add 192.168.1.11/24 dev e0; ip -n desk link set e0 up; ip -n desk route replace default via 192.168.1.1 ) &
ip netns exec desk node $D/desk-troca.cjs > $D/desk.log 2>&1; touch $D/done; wait $P; kill $I $G
grep -E "^\[mesa\]|ERRO|FALHOU" $D/desk.log | cut -c1-400; echo "roteador:"; cat $D/igd.log
