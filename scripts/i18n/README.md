# Translations (0.53)

How `data/i18n/de.json` was made, and how to add or refresh a language:

1. `node scripts/i18n/extract-app.cjs src/renderer work/i18n-app.json` and `node scripts/i18n/extract-app-scripts.cjs src/renderer work/i18n-app.json`: English text from the app's templates and scripts.
2. `node scripts/i18n/extract-addon.cjs addon/BackstageForever work/i18n-addon.json`: the addon's messages and message templates.
3. `node scripts/i18n/translate-local.cjs work/i18n-app.json work/i18n-addon.json work/i18n-de-cache.json`: translates with the local Ollama model (no cloud), keeping placeholders, colour codes and `/bf` commands; resumable.
4. `node scripts/i18n/assemble.cjs work/i18n-app.json work/i18n-addon.json work/i18n-de-cache.json data/i18n/de.json`: applies the hand corrections (edit `FIX` and `EXACT` there) and writes the dictionary.
5. `npm run build:locales`: writes `src/renderer/locales/de.js` and `addon/BackstageForever/BackstageForeverLocale.lua`. CI runs `npm run check:locales`.

Fixes from players go straight into `data/i18n/de.json` (keys are the exact English text), then step 5.
