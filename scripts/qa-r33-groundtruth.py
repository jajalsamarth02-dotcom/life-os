#!/usr/bin/env python3
"""Ground truth for Task 33 QA: per-subject-code open/overdue counts + late-day tiers."""
import json, urllib.request, datetime

data = json.load(urllib.request.urlopen("http://localhost:3000/api/assignments"))
now = datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000

groups = {}
for a in data["assignments"]:
    code = a.get("subjectCode") or "UNKNOWN"
    g = groups.setdefault(code, {"total": 0, "open": 0, "overdue": 0, "late_days": []})
    g["total"] += 1
    if a["status"] == "ACTIVE":
        due = datetime.datetime.fromisoformat(a["dueAt"].replace("Z", "+00:00")).timestamp() * 1000
        g["open"] += 1
        if due < now:
            g["overdue"] += 1
            g["late_days"].append(int((now - due) // 86_400_000))

print(f"total rows: {len(data['assignments'])}")
for code, g in sorted(groups.items(), key=lambda kv: (-kv[1]["overdue"], kv[0])):
    tiers = {}
    for d in g["late_days"]:
        t = ">21d" if d > 21 else ("8-21d" if d > 7 else "<=7d")
        tiers[t] = tiers.get(t, 0) + 1
    print(f"{code}: total={g['total']} open={g['open']} overdue={g['overdue']} tiers={tiers or '-'}")
print("courseNames:", json.dumps(data.get("courseNames", {}), indent=None)[:600])
