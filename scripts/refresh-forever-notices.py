"""Authoring helper for the data refresh (roadmap D7): moves the commit and build list in the
bundled NOTICE files to the refreshed snapshot. Counts quoted in prose are reported, not edited.

    python scripts/refresh-forever-notices.py <new commit> <old commit> [ignored]

Each notice gets the build list of its own pack (data/<pack>/pack.json): the packs do not all
merge the same builds, because an early build of a patch has only some of the upstream files.
"""
import io, json, os, re, sys

new, old = sys.argv[1], sys.argv[2]
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
# The first run of builds in a notice: a full build, then full or five-digit builds after commas.
RUN = re.compile(r"\d+\.\d+\.\d+\.\d{5}(?:,\s+(?:\d+\.\d+\.\d+\.)?\d{5})+")

for pack in ["forever", "forever-vendors", "forever-creatures", "forever-npc-locations", "forever-insights", "forever-loot", "forever-boss-loot"]:
    path = os.path.join(root, pack, "NOTICE")
    text = io.open(path, encoding="utf-8", newline="").read()
    nl = "\r\n" if "\r\n" in text else "\n"
    builds = [b["build"] if isinstance(b, dict) else b for b in json.load(io.open(os.path.join(root, pack, "pack.json"), encoding="utf-8"))["builds"]]
    before = text
    text = text.replace(old, new)

    def listed(m):
        run = m.group(0)
        if not re.search(r",\s+\d{5}\b", run):  # every build written in full
            if "\n" not in run:
                return ", ".join(builds)
            # Hard-wrapped notices: three builds a line, as before.
            return ("," + nl).join(", ".join(builds[i:i + 3]) for i in range(0, len(builds), 3))
        return builds[0] + ", " + ", ".join(b.split(".")[-1] for b in builds[1:])

    text, n = RUN.subn(listed, text, count=1)
    text = re.sub(r"reference client build \d+\.\d+\.\d+\.\d+", "reference client build " + builds[0], text)
    io.open(path, "w", encoding="utf-8", newline="").write(text)
    missing = [b for b in builds if b not in text and b.split(".")[-1] not in text]
    print(pack, "changed" if text != before else "UNCHANGED", "" if n else "NO BUILD LIST FOUND", "missing builds:" if missing else "", missing or "")
