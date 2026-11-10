# Third-party components

Backstage Forever's own source is MIT licensed. Dependencies retain their own licenses and notices; the repository license does not replace them. The distribution includes package license files and the SIL Open Font License notices for Cinzel and Source Sans 3.

The Anthropic Claude Agent SDK is copyright Anthropic PBC and subject to its vendor terms. Its unmodified JavaScript core is used only for initialization-time model discovery. The official Claude native executable is not bundled; users install it separately. The SDK's LICENSE.md remains in its packaged directory. See the vendor's [legal and compliance information](https://code.claude.com/docs/en/legal-and-compliance).

Other production dependency notices, including jose and transitive SDK dependencies, remain alongside those packages. Electron and the NSIS distribution retain their upstream notices.

Original generated illustrations and their production prompts are described in ARTWORK.md and ARTWORK-V3.md. No Blizzard artwork, faction logos or extracted game assets are included.

## Forever quest reference data

The local unreleased supplementary field notes retain a separate CC BY 4.0 license and normalization notice under `data/forever-insights/`. They use seven immutable Efficient Games files at commit `23f9636486d3d60479dc0bcee2356053c33faf2c`, product `wowf`, build `1.60.1.70862`. Exact per-file metadata, bytes, hashes and URLs remain in the source lock. Only bounded factual quest fields, exact trainer joins/service listings and status-valid enUS item names are retained; descriptions, narrative text, costs, abilities and game assets are excluded. Observation names' locale remains unspecified. This is one publisher, not seven independent sources. The compilation is not relicensed as MIT.

Data from Efficient Games (https://efficient.games), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Published source: [JIVESCORP/eg-link-output-wowf](https://github.com/JIVESCORP/eg-link-output-wowf), pinned for 0.12 to immutable commit `23f9636486d3d60479dc0bcee2356053c33faf2c`, live product `wowf`, build `1.60.1.70862`, English `enUS`.

Backstage Coding filters, normalizes, indexes and combines selected factual records; these are changes to the publisher's compilation. The derived data has its own license and source notices under `data/forever/`; the separate historical seller compilation retains matching notices under `data/forever-vendors/`. It is not relicensed as MIT. BF's implementation code remains MIT licensed. Blizzard's game text, names and other game content remain the property of their respective owners; the publisher's compilation license does not transfer those rights. No game artwork is included in this reference pack. See [coverage, provenance and privacy](FOREVER-DATA.md).
