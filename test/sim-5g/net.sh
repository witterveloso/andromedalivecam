#!/bin/bash
# Internet simulada: inet (203.0.113.0/24, ponto de encontro em .5) · roteador da mesa (NAT doméstico) · CGNAT do celular (NAT simétrico)
set -e
for n in inet rdesk desk rphone phone; do ip netns del $n 2>/dev/null || true; ip netns add $n; ip -n $n link set lo up; done
link(){ ip link add $1 netns $2 type veth peer name $3 netns $4; }
link i0 inet w0 rdesk; link i1 inet w1 rphone; link l0 rdesk d0 desk; link l1 rphone p0 phone
ip -n inet link add br0 type bridge; ip -n inet link set br0 up
for i in i0 i1; do ip -n inet link set $i master br0; ip -n inet link set $i up; done
ip -n inet addr add 203.0.113.5/24 dev br0
ip -n rdesk addr add 203.0.113.10/24 dev w0; ip -n rdesk link set w0 up; ip -n rdesk addr add 192.168.1.1/24 dev l0; ip -n rdesk link set l0 up
ip -n rphone addr add 203.0.113.20/24 dev w1; ip -n rphone link set w1 up; ip -n rphone addr add 100.64.0.1/24 dev l1; ip -n rphone link set l1 up
ip -n desk addr add 192.168.1.10/24 dev d0; ip -n desk link set d0 up; ip -n desk route add default via 192.168.1.1
ip -n phone addr add 100.64.0.10/24 dev p0; ip -n phone link set p0 up; ip -n phone route add default via 100.64.0.1
for r in rdesk rphone; do ip netns exec $r sysctl -qw net.ipv4.ip_forward=1; done
ip netns exec rdesk iptables -t nat -A POSTROUTING -o w0 -j MASQUERADE
# CGNAT de operadora: porta aleatória por destino (NAT simétrico), nada entra sem ter saído antes
ip netns exec rphone iptables -t nat -A POSTROUTING -o w1 -j MASQUERADE --random-fully
ip netns exec rphone iptables -A FORWARD -i w1 -m conntrack ! --ctstate ESTABLISHED,RELATED -j DROP
ip netns exec rdesk iptables -A FORWARD -i w0 -m conntrack ! --ctstate ESTABLISHED,RELATED,DNAT -j DROP
echo pronto
