#!/bin/bash
unset HTTPS_PROXY HTTP_PROXY https_proxy http_proxy ALL_PROXY all_proxy NO_PROXY no_proxy; D=$(cd $(dirname $0) && pwd); cd "$D/../.."; rm -f $D/invite.txt $D/done; [ -f $D/cert.pem ] || openssl req -x509 -newkey rsa:2048 -nodes -keyout $D/key.pem -out $D/cert.pem -days 30 -subj "/CN=203.0.113.5" -addext "subjectAltName=IP:203.0.113.5" 2>/dev/null
ip netns exec inet node $D/inet.cjs > $D/inet.log 2>&1 & I=$!; sleep 1.5
ip netns exec phone node $D/phone.cjs > $D/phone.log 2>&1 & P=$!
ip netns exec desk node $D/desk.cjs > $D/desk.log 2>&1; touch $D/done; wait $P; kill $I
grep -E "^\[mesa\]|ERRO|FALHOU" $D/desk.log | cut -c1-600; grep -E "^\[cam\]|ERRO|FALHOU" $D/phone.log | tail -3 | cut -c1-500
