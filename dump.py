import json, sys
T = "/root/.claude/projects/-home-user-equalhk-crm/a5b4a913-3a3b-5e0c-9cfc-8fb225ce1049.jsonl"
calls, results = [], {}
for line in open(T, encoding="utf8"):
    try: o = json.loads(line)
    except Exception: continue
    m = o.get("message") or {}
    for c in (m.get("content") or []) if isinstance(m.get("content"), list) else []:
        if not isinstance(c, dict): continue
        if c.get("type") == "tool_use" and m.get("role") == "assistant":
            calls.append({"id": c["id"], "name": c["name"], "input": c.get("input") or {}})
        elif c.get("type") == "tool_result":
            cont = c.get("content")
            if isinstance(cont, list):
                cont = "".join(x.get("text", "") for x in cont if isinstance(x, dict))
            results[c.get("tool_use_id")] = {"err": bool(c.get("is_error")), "text": cont or ""}
out = []
for i, c in enumerate(calls):
    r = results.get(c["id"], {"err": None, "text": ""})
    blob = json.dumps(c["input"], ensure_ascii=False)
    if "global-call-crm" not in blob: continue
    out.append({"i": i, **c, "err": r["err"], "result": r["text"]})
json.dump(out, open("events.json", "w", encoding="utf8"), ensure_ascii=False)
for e in out:
    inp = e["input"]
    desc = inp.get("file_path") or (inp.get("command") or "")[:110].replace("\n", " ⏎ ")
    print(e["i"], e["name"], "ERR" if e["err"] else "ok ", desc)
