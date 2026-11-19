# Field Dispatch renderer integration

Load `field-dispatch.css` and `field-dispatch.js` in the desktop shell only. Create one instance with `window.FieldDispatch.create({ host, actions, onDismiss, illustration })`. Use a persistent host outside the app's replaceable render root. The shell owns readiness/foreground/setup checks, persistence, fetching public data, and the Help or Settings **What’s New** entry point. The dialog makes no IPC calls, requests, or settings writes.

```js
const dispatch = FieldDispatch.create({
  host: document.body,
  illustration: "art/heroes/whats-new.webp", // optional; local compass fallback
  actions: {
    preparation: { label: "Open Preparation", run: openPreparation },
  },
  onDismiss: (reason) => { /* apply to the active pending range only */ },
});

dispatch.openRecap(publicModel, focusReturnTarget, "en"); // startup, after readiness gates
dispatch.openHistory(publicModel, whatsNewButton, "de"); // explicit manual entry
```

Both open methods return `false` without changing the view if already open, or if the host was detached. Locale defaults to the document language; optional explicit locale accepts English or German (including `de-DE` and `deDE`). The caller can translate its own action labels. Pass a stable, focusable element as the return target, or omit it to capture the currently focused element.

## Public model adapter

Use trusted release-journal data and sort release groups newest first before passing them in. The UI preserves supplied release/category order; it does not infer an installed range or deduplicate by title, which could hide corrections. If the recap needs range-specific deduplication, supply `recapReleases` separately; `releases` remains the full searchable history.

```js
{
  status: "updated", // only this status claims an installed upgrade; others use neutral current-version copy
  fromVersion: "1.9.0",
  toVersion: "1.11.0",
  rangeVersions: ["1.10.0", "1.11.0"], // exact covered groups; exclude the predecessor
  historyIncomplete: true, // explicitly announce missing older records
  releases: [{
    version: "1.11.0",
    sections: [{
      kind: "compatibility", // new | improved | fixed | compatibility | desktop | addon
      entries: [{
        id: "desktop-private-prep",
        title: "Private preparation stays on desktop",
        summary: "The in-game overlay does not use private preparation.",
        platforms: ["desktop", "addon"], // allowed: desktop | addon | macos | windows
        highlight: true, // optional; recap uses up to three, full notes remain available
        actionId: "preparation", // optional; ignored unless registered by the shell
      }],
    }],
  }],
}
```

- **Got it** sends `onDismiss("acknowledged")`; **Not now** and Escape send `onDismiss("later")` for an upgrade recap, including when its history subview is open. Manual history and neutral current-version views do not acknowledge an update. Selecting an action closes the dialog and runs only its registered callback, without acknowledgement. The shell decides what to do with a pending range.
- The history view renders all supplied versions. Search matches version, title, summary, category and platform; longer lists have native version disclosures. Bundled notes are plain English text, while the controls and headings support English/German. The optional image is decorative and chosen by the caller, never by release data.

## Test

Run `node scripts/field-dispatch-smoke.cjs` with the project's Electron and Playwright dependencies installed. It mounts the shipping renderer in an isolated Electron window with public fixture data. `BF_DISPATCH_SCREENSHOTS` optionally writes screenshot files to a named directory.

Run `npm run test:field-dispatch` for the full desktop flow. It launches the real main, preload, and renderer in isolated profiles; the fixture supplies the installed identity and foreground focus without stealing system focus. It exercises fresh and legacy startup, deferred and acknowledged upgrades across process restarts, and search and navigation from **Settings → Updates → What’s New**. Network and live-game integrations are disabled in this fixture; it does not run a Windows installer.
