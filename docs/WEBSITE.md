# The website pages

`backstagecoding.com/backstage-forever/` is a folder of static files. The download page
(`index.html`, `landing.css`, `desktop-downloads.js`) is kept by hand on the server. Four more pages
are generated from this repo so they follow each release:

| Page | Made from |
|---|---|
| `whats-new.html` | `data/whats-new-catalog.json`, the list the app shows after an update (stable releases only) |
| `tour.html` | the pictures in `tour/` and the short texts in `scripts/build-site.cjs` |
| `commands.html` | `src/renderer/commands.js`, the list behind Help → Commands |
| `coverage.html` | the same count the app shows under Help → Data coverage, plus totals from the bundled packs |

`tour.css` styles them, and one marked block (`<!-- bf:more -->`) on the download page links to them.
The pages take the site's own header, footer, stylesheets and scripts from the `index.html` they are
built next to, need no JavaScript to be read, and load nothing from other sites.

## For each release

1. Copy the live folder from the server to a working folder, for example `../bf-site-next/backstage-forever`.
2. Pages (no window opens, a few seconds):

   ```
   node scripts/build-site.cjs ../bf-site-next/backstage-forever
   node scripts/build-site.cjs ../bf-site-next/backstage-forever --check
   ```

   `--check` fails if a page is stale, a picture is missing or a link does not resolve.
3. Pictures, only when screens changed (opens the app in a window that never takes focus; one
   Electron window at a time, so take the lock first):

   ```
   BF_TEST_INACTIVE=1 node scripts/site-screenshots.cjs work/site-shots \
     --webp ../bf-site-next/backstage-forever/tour --game "<your>/World of Warcraft/_forever_"
   ```

   Look at the PNGs in `work/site-shots` before publishing. `--only now,travel` retakes a few.
4. Upload the folder. Nothing in this repo deploys it.

## About the pictures

- The characters are fixtures (`scripts/site-fixture.cjs`): invented names, real quest and item ids.
  Never use a real character.
- `--game` points at a WoW Forever folder that is only read, for item names, talents, recipes and
  icons. The app itself is connected to a throwaway folder, so nothing is installed into the real
  game. Without `--game` the screens that need game files (talents, gear plan, recipe book, skill
  path, craft profit) show their "connect the game" state.
- The version number in the app's side rail is left out of the pictures, so they do not go stale
  with each release.
- A new picture: add a row to `scripts/site-shots.cjs`, then a row to `TOUR` in `scripts/build-site.cjs`.
