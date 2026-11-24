# Contributing to Backstage Forever

Thanks for helping! Bug reports, translation fixes and code are all welcome.

## Reporting

- **Bugs:** open an issue with the "Something isn't working" form. Help → Support in the app makes a report with secrets left out.
- **Translations:** use the "Translation fix" form, or edit `data/i18n/de.json` directly (the keys are the exact English text) and run `npm run build:locales`. See [scripts/i18n/README.md](scripts/i18n/README.md).
- **Security problems:** please report privately, as described in [SECURITY.md](SECURITY.md).

## Code

1. Node.js 24, then `npm ci`. `npm start` runs the app; `npm test` runs the unit tests.
2. Keep the rules that make Backstage Forever safe to use:
   - The addon uses only Blizzard's public addon interface. It never automates play: no auto-accepting, clicking, moving or targeting, and never replaces or hooks Blizzard functions.
   - Game data is read from the player's own installation, on their computer, and never bundled or uploaded.
   - Only what [docs/PRIVACY.md](docs/PRIVACY.md) lists may leave the computer, each part with its own off switch: map discoveries, anonymous statistics, and reports the player sends. Never account, character, realm or guild names, never files, never chat. A new field needs a line on the privacy page first.
   - Horde and Alliance get the same care.
   - Art is original only. No Blizzard art, logos or lettering.
3. Follow [docs/STYLE-GUIDE.md](docs/STYLE-GUIDE.md) for anything visible: contrast, the 11px minimum, labels for screen readers.
4. Add or update tests with your change. CI runs the same checks as `.github/workflows/ci.yml`; generated files (`npm run build:find-index`, `build:guided-route`, `build:locales` and the `check:*` scripts) must be current.
5. Update Help → Commands (`src/renderer/commands.js`) when you add or change a command or feature.

## Releases

Maintainers release from `main` with a version tag; see [docs/RELEASING.md](docs/RELEASING.md).

By contributing you agree that your contribution is licensed under the project's [MIT License](LICENSE).
