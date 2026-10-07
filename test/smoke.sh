#!/usr/bin/env bash
cd /mnt/c/Users/enddooa/madrid-kids
PORT=8820 node server.js >/dev/null 2>&1 &
SRV=$!
sleep 1.5
echo -n "index: ";     curl -s -o /dev/null -w "%{http_code}" http://localhost:8820/
echo -n " | manifest: "; curl -s -o /dev/null -w "%{http_code}" http://localhost:8820/manifest.webmanifest
echo -n " | sw: ";       curl -s -o /dev/null -w "%{http_code}" http://localhost:8820/sw.js
echo -n " | favicon: ";  curl -s -o /dev/null -w "%{http_code}" http://localhost:8820/favicon.ico
echo -n " | health: ";   curl -s http://localhost:8820/health
echo
echo -n "search count: "
curl -s -X POST http://localhost:8820/api/search -H "Content-Type: application/json" \
  --data-binary '{"age":3,"weeks":1,"categories":["CuentacuentosTiteresMarionetas"]}' \
  | grep -o '"type":"result"' | head -1
kill $SRV 2>/dev/null || true
