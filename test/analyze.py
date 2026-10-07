#!/usr/bin/env python3
import json, glob, os, re
RUNS = "test/runs"

def load_result(path):
    res = None
    prog = []
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        o = json.loads(line)
        if o.get("type") == "result":
            res = o["data"]
        elif o.get("type") == "progress":
            prog.append(o["data"].get("msg", ""))
        elif o.get("type") == "error":
            print("  ERROR:", o["data"])
    return res, prog

# phrases that signal older/adult content
ADULT_RE = re.compile(r"a partir de\s*(1[0-8]|[7-9])\s*an|edad recomendada[^.]*(1[0-8]|[7-9])\s*an|mayores de\s*(1[0-7])", re.I)

for path in sorted(glob.glob(f"{RUNS}/*.ndjson")):
    name = os.path.basename(path)[:-7]
    res, prog = load_result(path)
    if not res:
        print(f"[{name}] NO RESULT")
        continue
    acts = res["activities"]
    dated = [a for a in acts if not a.get("standing")]
    standing = [a for a in acts if a.get("standing")]
    # flag suspicious: age search is res['age']; entry desc says older-only
    age = res["age"]
    suspicious = []
    for a in dated:
        txt = (a["title"] + " " + (a.get("description") or ""))
        m = ADULT_RE.search(txt)
        if m and not a.get("age_known"):
            suspicious.append(a["title"][:45])
    print(f"[{name}] total={res['count']} dated={len(dated)} standing={len(standing)} age={age}")
    print(f"    progress steps: {len(prog)}")
    if suspicious:
        print(f"    SUSPICIOUS (older-only text, shown as kid): {len(suspicious)}")
        for s in suspicious[:6]:
            print("      -", s)
