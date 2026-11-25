#!/bin/bash
# $1: semupnp | upnp | empresa
D=$(cd $(dirname $0) && pwd); $D/net.sh >/dev/null
if [ "$1" = upnp ]; then (unset HTTPS_PROXY HTTP_PROXY; ip netns exec rdesk node $D/igd.cjs > $D/igd.log 2>&1 &) ; sleep 0.5; fi
$D/run.sh "$1"
pkill -f "$D/igd.cjs" 2>/dev/null; true
