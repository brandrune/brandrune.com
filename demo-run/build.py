#!/usr/bin/env python3
"""Turn the recorded run in demo-run/results.json into public/demo/run.json,
the data the home page replays. Labels come from the skill's own cell()
function, so the page shows exactly what the script printed.

    python3 demo-run/build.py /path/to/skills/brandrune/scripts/brandrune.py
"""

import importlib.util
import json
import os
import sys
import time
from pathlib import Path

# The run was read on Kyle's clock; render its timestamps the same way.
os.environ["TZ"] = "America/Denver"
time.tzset()

here = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("brandrune", sys.argv[1])
br = importlib.util.module_from_spec(spec)
spec.loader.exec_module(br)

doc = json.loads((here / "results.json").read_text())
order = [line.split()[0] for line in (here / "names.txt").read_text().splitlines() if line.strip()]
by_name = {n["name"]: n for n in doc["names"]}
tlds = doc["tlds"]


def kind(res):
    """The chip class: open (price verified), openstar (open*), or the status."""
    if res["status"] == br.OPEN:
        return "open" if br.price_verified(res) else "openstar"
    return res["status"]


rows = []
for name in order:
    n = by_name[name]
    rows.append([n["name"], n["style"], n["length"]] + [[kind(n["domains"][t]), br.cell(n["domains"][t])] for t in tlds])

hosts = {}
for n in doc["names"]:
    for t in tlds:
        src = (n["domains"][t].get("registry") or {}).get("source", "")
        if src.startswith("https://"):
            hosts[t] = src.split("/")[2]

out = {
    "tool": doc["tool"],
    "description": doc["description"],
    "checked_at": doc["checked_at"],
    "seconds": doc["seconds"],
    "tlds": tlds,
    "hosts": hosts,
    "columns": ["name", "style", "length"] + tlds,
    "rows": rows,
}
# check-stdout.txt and check-stderr.txt are not captured from the terminal.
# They are re-rendered from results.json with the script's own render_text()
# and the same first stderr line cmd_check prints, which is what `check`
# prints for this run with no filters. The page quotes these lines and a test
# holds it to them.
shown = sorted(doc["names"], key=lambda e: br.sort_key(e, tlds))
stdout = br.render_text(doc, shown, "")
(here / "check-stdout.txt").write_text(stdout + "\n")
stderr_first = f"checking {len(doc['names'])} names on {', '.join('.' + t for t in tlds)}" + (" with Vercel pricing" if doc.get("registrar") else "")
(here / "check-stderr.txt").write_text(stderr_first + "\n")

dest = here.parent / "public" / "demo" / "run.json"
dest.write_text(json.dumps(out, separators=(",", ":")) + "\n")
print(f"wrote {dest} ({dest.stat().st_size} bytes, {len(rows)} names)")
