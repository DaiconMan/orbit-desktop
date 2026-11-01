#!/bin/zsh
# Orbit Desktop helper: TCP connect latency to LAN hosts, written as JSON for the dev server
# (providers.ping.external_file). Useful when macOS "Local Network" privacy blocks the Python
# server from reaching LAN hosts but a shell started from a permitted app (e.g. Terminal) can.
#
#   tcp-latency.sh NAME=HOST:PORT [NAME=HOST:PORT ...]
#   e.g. tcp-latency.sh NAS=192.168.1.10:22 ROUTER=192.168.1.1:80
#
# Output: ${ORBIT_LATENCY_FILE:-~/Library/Caches/orbit-desktop/latency.json}
#   {"targets": {"NAS": 3.1, "ROUTER": null}, "ts": 1700000000}
zmodload zsh/datetime
OUT=${ORBIT_LATENCY_FILE:-$HOME/Library/Caches/orbit-desktop/latency.json}
INTERVAL=${ORBIT_LATENCY_INTERVAL:-10}
mkdir -p "${OUT:h}"
(( $# )) || { print -u2 "usage: $0 NAME=HOST:PORT ..."; exit 2; }
for spec in "$@"; do
  [[ $spec =~ '^[A-Za-z0-9_-]{1,24}=[A-Za-z0-9.:-]+:[0-9]{1,5}$' ]] || { print -u2 "bad target: $spec"; exit 2; }
done
while true; do
  json='{"targets": {'; sep=''
  for spec in "$@"; do
    name=${spec%%=*}; hp=${spec#*=}; host=${hp%:*}; port=${hp##*:}
    t0=$EPOCHREALTIME
    if /usr/bin/nc -z -G 2 -- "$host" "$port" >/dev/null 2>&1; then
      val=$(printf '%.1f' $(( (EPOCHREALTIME - t0) * 1000 )))
    else
      val=null
    fi
    json+="$sep\"$name\": $val"; sep=', '
  done
  print -r -- "$json}, \"ts\": $EPOCHSECONDS}" > "$OUT.tmp" && mv -f "$OUT.tmp" "$OUT"
  sleep $INTERVAL
done
