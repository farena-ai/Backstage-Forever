# The website

`https://backstagecoding.com/backstage-forever/` is a folder of static files. Everything a visitor
reads there is generated from this repo, so it follows each release:

| File | Made from |
|---|---|
| `index.html` | `site/index.template.html` (the home page's layout and hand-written text) and `site/content.cjs` (features, steps, questions, downloads) |
| `tour.html` | the pictures in `tour/` and their texts in `site/content.cjs` |
| `download.html` | the downloads and install steps in `site/content.cjs` |
| `whats-new.html` | `data/whats-new-catalog.json`, the list the app shows after an update (stable releases only) |
| `commands.html` | `src/renderer/commands.js`, the list behind Help → Commands |
| `coverage.html` | the same count the app shows under Help → Data coverage, plus totals from the bundled packs |
| `site.css` | `site/site.css` |
| `sitemap-backstage-forever.xml` | the list of pages, with the build date |
| `tour/*.webp`, `og-image.jpg` | `scripts/site-screenshots.cjs` (the app itself, with fixture characters) |

Kept by hand in the folder and never written by the build: `desktop-downloads.js` (turns the
download buttons into direct file links when GitHub answers), `crest.png`, `journey.webp` (the
painting behind the home page's heading), `compass.png` and `helpers.png` (real pictures from the
game). `landing.css`, `setup.webp`, `forever.css` and `downloads.js` are no longer used by these
pages; they stay in the folder in case another page of the parent site still links to them.

The parent site's header, footer, stylesheet (`/css/products.css`) and script are taken from the
`index.html` the build finds in the folder, so every page keeps the live site's frame. Everything
inside `<main>` is styled by `site.css` alone, with its own `bfx-` classes: the pages do not depend
on any rule of the parent stylesheet. No page needs JavaScript to be read, and nothing is loaded
from another site (no fonts, scripts or trackers).

## For each release

1. Copy the live folder from the server to a working folder, for example `../bf-site-next/backstage-forever`.
2. Pages (no window opens, a few seconds):

   ```
   node scripts/build-site.cjs ../bf-site-next/backstage-forever
   node scripts/build-site.cjs ../bf-site-next/backstage-forever --check
   ```

   `--check` fails if a page is stale, a picture is missing, a link does not resolve, or a page
   breaks one of the rules below. `--date YYYY-MM-DD` sets the sitemap's date (today otherwise).
3. Pictures, only when screens changed (opens the app in a window that never takes focus; one
   Electron window at a time, so take the lock first):

   ```
   BF_TEST_INACTIVE=1 node scripts/site-screenshots.cjs work/site-shots \
     --webp ../bf-site-next/backstage-forever/tour --og ../bf-site-next/backstage-forever/og-image.jpg \
     --game "<your>/World of Warcraft/_forever_"
   ```

   Look at the PNGs in `work/site-shots` before publishing. `--only now,travel` retakes a few
   (`--og` needs `now` among them, or an earlier `now.png` in the output folder). Then run step 2
   again: the pages carry each picture's real size.
4. Upload the whole folder. Nothing in this repo deploys it.

## Once, on the parent site

The build never touches the parent site. Add these by hand (they are not in this folder's reach):

- in the parent `robots.txt`, one line:

  ```
  Sitemap: https://backstagecoding.com/backstage-forever/sitemap-backstage-forever.xml
  ```

- if the parent `sitemap.xml` is a sitemap index, one entry:

  ```
  <sitemap><loc>https://backstagecoding.com/backstage-forever/sitemap-backstage-forever.xml</loc></sitemap>
  ```

  If it is a plain list of pages (a `<urlset>`), a sitemap cannot point to another one: copy the six
  `<url>` lines from `sitemap-backstage-forever.xml` into it instead, and replace the old single
  `/backstage-forever/` entry.

## What every page must keep (the tests and `--check` enforce it)

- One `<h1>`, headings that never skip a level, `lang="en"`.
- Its own `<title>` (at most 60 characters) and description (at most 155), a canonical link under
  `https://backstagecoding.com/backstage-forever/`, Open Graph and Twitter card tags with
  `og-image.jpg` (1200×630).
- Structured data that parses: `SoftwareApplication` and `FAQPage` on the home page (the answers
  are the same words the page shows), `BreadcrumbList` on the others. No version number in it and
  no ratings.
- Every picture with alt text, width and height; screenshots as WebP in two widths (`srcset`), and
  everything below the first one `loading="lazy"`.
- The button "Download for Windows — free" at the top and the bottom, as a plain link to the
  latest release with `data-download="windows"`. The desktop app is the product; no page may say
  it is optional.
- "Not affiliated with or endorsed by Blizzard Entertainment" above the site footer. No Blizzard
  logos; the game is named in words only.
- No app version number outside `whats-new.html`, so the other pages do not go stale.

## Changing the words

- Home page layout and its hand-written paragraphs: `site/index.template.html`. The `{{…}}` blanks
  are filled by the build.
- Feature sections (heading, two or three plain paragraphs, the `/bf` commands, the picture),
  questions and answers, steps, downloads: `site/content.cjs`. Write what the app does in plain
  sentences; no numbers the repo cannot back, and honest limits go on the coverage page.
- Looks: `site/site.css`. The small `@layer bf-fallback` block at its top only shows where the
  parent stylesheet is missing (a local preview); on the live site the parent's rules win.

## About the pictures

- The characters are fixtures (`scripts/site-fixture.cjs`): invented names, real quest and item ids.
  Never use a real character.
- `--game` points at a WoW Forever folder that is only read, for item names, talents, recipes,
  icons and map art. The app itself is connected to a throwaway folder, so nothing is installed
  into the real game. With `--game` the level 60 fixture also gets spent talents and known recipes
  worked out from those files. Without it the screens that need game files (talents, gear plan,
  recipe book, skill path, craft profit, the map's art) show their "connect the game" state and
  must not be published.
- Pictures are taken in a 1600×1000 window at scale 1 and cut to the page content: no side rail,
  no scrollbars, and the lower edge falls in a gap instead of through a line of text. Only the
  home page's opening picture (`now`) shows the whole window. Each is saved as WebP at its own
  width (at most 1600) and at 800 (`-800`), never enlarged.
- The version number in the app's side rail is left out, so the pictures do not go stale.
- A new picture: add a row to `scripts/site-shots.cjs`, then list it under a feature in
  `site/content.cjs` (file name, title, alt text that says what is on it, caption). A test fails
  when the two lists differ.
- The two in-game pictures (`compass.png`, `helpers.png`) are real screenshots. Do not replace
  them with drawn mock-ups.
