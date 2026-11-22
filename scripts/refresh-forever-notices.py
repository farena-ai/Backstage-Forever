"""Authoring helper for the data refresh (roadmap D7): moves the commit and build list in the
bundled NOTICE files to the refreshed snapshot. Counts quoted in prose are reported, not edited.

    python scripts/refresh-forever-notices.py <new commit> <old commit> <builds newest first, comma separated>
"""
import io, os, re, sys

new, old, builds = sys.argv[1], sys.argv[2], sys.argv[3].split(",")
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
full = ", ".join(builds)
short = builds[0] + ", " + ", ".join(b.split(".")[-1] for b in builds[1:])
OLD_FULL = re.compile(r"1\.60\.1\.70888, 1\.60\.1\.70862,\s+1\.60\.1\.70840,\s+1\.60\.1\.70790")
OLD_SHORT = "1.60.1.70888, 70862, 70840, 70790"

for pack in ["forever", "forever-vendors", "forever-creatures", "forever-npc-locations", "forever-insights", "forever-loot", "forever-boss-loot"]:
    path = os.path.join(root, pack, "NOTICE")
    text = io.open(path, encoding="utf-8", newline="").read()
    nl = "\r\n" if "\r\n" in text else "\n"
    before = text
    text = text.replace(old, new)
    # Wrap the longer list at two builds a line, as the notices are hard-wrapped.
    wrapped = (nl).join(", ".join(builds[i:i + 3]) + ("," if i + 3 < len(builds) else "") for i in range(0, len(builds), 3))
    text = OLD_FULL.sub(lambda _m: wrapped, text)
    text = text.replace(OLD_SHORT, short)
    text = text.replace("reference client build 1.60.1.70888", "reference client build " + builds[0])
    io.open(path, "w", encoding="utf-8", newline="").write(text)
    missing = [b for b in builds if b not in text and b.split(".")[-1] not in text]
    print(pack, "changed" if text != before else "UNCHANGED", "missing builds:" if missing else "", missing or "")
