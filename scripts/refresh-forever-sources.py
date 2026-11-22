"""Authoring helper for the data refresh (roadmap D7): rewrites the pinned source lists for the
creature and NPC-location packs from files already fetched by refresh-forever-data.cjs.

    python scripts/refresh-forever-sources.py <sources dir>/<commit> <commit>

It only edits src/core/creature-sources.cjs and src/core/npc-location-sources.cjs (the COMMIT line
and the SOURCES rows). Run the two compilers afterwards and update their pinned coverage.
"""
import hashlib, io, json, os, re, sys

src_dir, commit = sys.argv[1], sys.argv[2]
assert re.fullmatch(r"[a-f0-9]{40}", commit)
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
builds = sorted((d for d in os.listdir(src_dir) if re.fullmatch(r"\d+\.\d+\.\d+\.\d+", d)), key=lambda b: -int(b.split(".")[-1]))


def rows(name, extra):
    out = []
    for build in builds:
        path = os.path.join(src_dir, build, name)
        if not os.path.exists(path):
            continue
        data = open(path, "rb").read()
        meta = json.loads(data)["meta"]
        assert meta["clientBuild"] == build, (build, meta["clientBuild"])
        args = ["'%s'" % build, "'%s'" % meta["collectedOn"]["first"], "'%s'" % meta["collectedOn"]["last"], str(meta["sources"])]
        for key in extra:
            if meta.get(key):
                args.append(str(meta[key]))
        out.append(" source('%s',%d,'%s',meta(%s))," % (build, len(data), hashlib.sha256(data).hexdigest(), ",".join(args)))
        known = {"attribution", "clientBuild", "collectedOn", "dataset", "license", "product", "schemaVersion", "sources", *extra}
        unknown = set(meta) - known
        assert not unknown, (name, build, unknown)
    return out


def rewrite(file, name, extra):
    path = os.path.join(root, "src", "core", file)
    text = io.open(path, encoding="utf-8", newline="").read()
    nl = "\r\n" if "\r\n" in text else "\n"
    text, n = re.subn(r"const COMMIT='[a-f0-9]{40}';", "const COMMIT='%s';" % commit, text)
    assert n == 1, file
    start = text.index("const SOURCES=Object.freeze([") + len("const SOURCES=Object.freeze([")
    end = text.index("].map(Object.freeze));", start)
    text = text[:start] + nl + nl.join(rows(name, extra)) + nl + text[end:]
    io.open(path, "w", encoding="utf-8", newline="").write(text)
    print(file, len(rows(name, extra)), "builds")


rewrite("creature-sources.cjs", "creatures.json", ["combatLogUploads"])
rewrite("npc-location-sources.cjs", "npcs.json", [])
