import csv, json, re, glob, os
rows = list(csv.DictReader(open(".runs/corpus/summary.tsv"), delimiter="\t"))
by = {}
for r in rows:
    base = re.sub(r"2?-resume$", "", r["name"]).replace("-resume", "")
    base = re.sub(r"2$", "", base) if base.endswith("2") and base[:-1] in by else base
    e = by.setdefault(base, {"passes": 0, "cost": 0.0, "results": [], "agent": r["agent"]})
    e["passes"] += 1
    m = re.search(r"\$([\d.]+)", r["cost"] or ""); e["cost"] = max(e["cost"], float(m.group(1)) if m else 0)  # each pass reports the agent's cumulative cost
    e["results"].append(r["result"])
print(f"{'request':22} {'final':20} {'passes':>6} {'cost':>8}  units  done  review")
tot=0
for name, e in by.items():
    rec = glob.glob(f".runs/build-{e['agent']}.json")
    units = done = rev = "?"
    if rec:
        p = json.load(open(rec[0]))["polya"]
        units = f"{sum(1 for u in p.get('unitRecords',[]) if u.get('passed'))}/{len(p.get('unitRecords',[]))}"
        ch = p.get("checks") or []; done = f"{sum(1 for c in ch if c['passed'])}/{len(ch)}"
        rev = (p.get("review") or {}).get("verdict", "-")
    tot += e["cost"]
    print(f"{name:22} {e['results'][-1]:20} {e['passes']:>6} {e['cost']:>8.2f}  {units:6} {done:5} {rev}")
print(f"{'total':22} {'':20} {'':>6} {tot:>8.2f}")
