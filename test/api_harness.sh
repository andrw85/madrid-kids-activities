#!/usr/bin/env bash
# End-to-end harness: start server, run a set of search jobs via the API,
# save each result stream, and print quality metrics. Non-destructive.
set -u
cd /mnt/c/Users/enddooa/madrid-kids
mkdir -p test/runs
export PORT=${PORT:-8801}
node server.js > test/runs/server.log 2>&1 &
SRV=$!
# wait for server
for i in $(seq 1 20); do
  if curl -s "http://localhost:$PORT/" -o /dev/null; then break; fi
  sleep 0.3
done

run_job () {
  local name="$1"; local body="$2"
  curl -s -X POST "http://localhost:$PORT/api/search" \
    -H 'Content-Type: application/json' \
    --data-binary "$body" > "test/runs/$name.ndjson"
  echo "saved test/runs/$name.ndjson ($(wc -c < test/runs/$name.ndjson) bytes)"
}

run_job age3_3w   '{"age":3,"weeks":3,"categories":[],"free_only":false,"strict_age":false,"query":""}'
run_job age3_titeres '{"age":3,"weeks":3,"categories":["CuentacuentosTiteresMarionetas"],"free_only":false,"strict_age":false,"query":""}'
run_job age3_free '{"age":3,"weeks":2,"categories":[],"free_only":true,"strict_age":false,"query":""}'
run_job age3_strict '{"age":3,"weeks":3,"categories":[],"free_only":false,"strict_age":true,"query":""}'
run_job age8_3w   '{"age":8,"weeks":3,"categories":[],"free_only":false,"strict_age":false,"query":""}'
run_job age0_baby '{"age":0,"weeks":4,"categories":[],"free_only":false,"strict_age":false,"query":""}'
run_job impossible '{"age":3,"weeks":1,"categories":["ClubesLectura"],"free_only":true,"strict_age":true,"query":"zzzznotfound"}'
run_job specialq  '{"age":3,"weeks":3,"categories":[],"free_only":false,"strict_age":false,"query":"<script>&título"}'
run_job badjob    '{"age":"tres","weeks":"x"}'

kill $SRV 2>/dev/null || true
echo "=== server.log ==="
cat test/runs/server.log
