# Translations (0.53)

How `data/i18n/de.json` was made, and how to add or refresh a language:

1. `node scripts/i18n/extract-app.cjs src/renderer work/i18n-app.json` and `node scripts/i18n/extract-app-scripts.cjs src/renderer work/i18n-app.json`: English text from the app's templates and scripts.
2. `node scripts/i18n/extract-addon.cjs addon/BackstageForever work/i18n-addon.json`: the addon's messages and message templates.
3. `node scripts/i18n/translate-local.cjs work/i18n-app.json work/i18n-addon.json work/i18n-de-cache.json`: translates with the local Ollama model (no cloud), keeping placeholders, colour codes and `/bf` commands; resumable.
4. `node scripts/i18n/assemble.cjs work/i18n-app.json work/i18n-addon.json work/i18n-de-cache.json data/i18n/de.json`: applies the hand corrections (edit `FIX` and `EXACT` there) and writes the dictionary.
5. `npm run build:locales`: writes `src/renderer/locales/de.js` and `addon/BackstageForever/BackstageForeverLocale.lua`. CI runs `npm run check:locales`.

Fixes from players go straight into `data/i18n/de.json` (keys are the exact English text), then step 5.

## More languages (roadmap P1)

Every `data/i18n/<lang>.json` is compiled: the file name is the two-letter language code. To add one:

1. Copy the key list of `data/i18n/de.json` (German holds every key) and translate each value. Keys stay the exact English text.
2. Set `name` to the language's own name (it is listed that way in the app), `machineNote` to "machine-translated" in that language, and `machineTranslated: true` until a native speaker has reviewed it.
3. The game locale codes come from `GAME_LOCALES` in `scripts/build-locales.cjs` (`fr` is frFR; `es` is esES and esMX). For a language not listed there, add `"gameLocales": ["xxXX"]` to the dictionary.
4. Add `<script src="locales/<lang>.js"></script>` before `i18n.js` in `src/renderer/index.html` (the strict content policy loads nothing on the fly), then `npm run build:locales` and `node --test tests/i18n.test.cjs`.

Rules the tests hold every language to: no key German has is missing, no empty value, `/bf` commands, `/reload`, colour codes and format codes untouched, addon templates keep their `%` codes in the English order, app templates keep each `{0}` placeholder.

French and Spanish are first translations made with Claude and await a native review. All languages share one `BackstageForeverLocale.lua` (about 130 KB per language; only the block for the game's own language is built). The test caps the file at 1 MB: split it per language before then.
