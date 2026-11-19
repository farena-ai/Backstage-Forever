"use strict";

window.FieldDispatch = (() => {
  const rendererUrl = document.currentScript?.src ?? document.baseURI;
  const copy = {
    en: {
      brand: "Field Dispatch", current: "What’s new in {to}", updated: "Updated from {from} to {to}",
      history: "Dispatch history", recapIntro: "A briefing on the changes in this update.",
      currentIntro: "Read the available notes for this version.", historyIntro: "Browse the release notes bundled with this app.",
      gap: "Some older release notes are unavailable. You can browse the notes we have.", highlights: "Highlights",
      search: "Search changes", clear: "Clear search", noMatch: "No matching changes.",
      noNotes: "No release notes are available for this view.", matches: "Matching changes: {count}",
      all: "View all changes", back: "Back to recap", later: "Not now", gotIt: "Got it", close: "Close",
      release: "Version {version}", new: "New", improved: "Improved", fixed: "Fixed",
      compatibility: "Compatibility & privacy", desktop: "Desktop", addon: "Addon", macos: "macOS", windows: "Windows",
    },
    de: {
      brand: "Field Dispatch", current: "Neues in {to}", updated: "Von {from} auf {to} aktualisiert",
      history: "Änderungsverlauf", recapIntro: "Die Änderungen in diesem Update im Überblick.",
      currentIntro: "Hier findest du die verfügbaren Hinweise zu dieser Version.", historyIntro: "Durchsuche die in der App enthaltenen Versionshinweise.",
      gap: "Einige ältere Versionshinweise fehlen. Du kannst die verfügbaren Hinweise durchsuchen.", highlights: "Höhepunkte",
      search: "Änderungen suchen", clear: "Suche leeren", noMatch: "Keine passenden Änderungen.",
      noNotes: "Für diese Ansicht sind keine Versionshinweise verfügbar.", matches: "Passende Änderungen: {count}",
      all: "Alle Änderungen anzeigen", back: "Zurück zur Übersicht", later: "Nicht jetzt", gotIt: "Verstanden", close: "Schließen",
      release: "Version {version}", new: "Neu", improved: "Verbessert", fixed: "Behoben",
      compatibility: "Kompatibilität und Datenschutz", desktop: "Desktop", addon: "Addon", macos: "macOS", windows: "Windows",
    },
  };
  const categories = new Set(["new", "improved", "fixed", "compatibility", "desktop", "addon"]);
  const platforms = new Set(["desktop", "addon", "macos", "windows"]);
  const items = (value) => Array.isArray(value) ? value : [];
  const versionLabel = (value) => typeof value === "string" && value.trim();

  function create({ host, actions = {}, onDismiss = () => {}, illustration } = {}) {
    if (!host) throw new TypeError("Field Dispatch requires a host element");
    const doc = host.ownerDocument;
    const el = (tag, className, text) => {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (typeof text === "string") node.textContent = text;
      return node;
    };
    const button = (label, handler, className) => {
      const node = el("button", className, label);
      node.type = "button";
      node.addEventListener("click", handler);
      return node;
    };
    const root = el("dialog", "field-dispatch");
    root.setAttribute("aria-labelledby", "field-dispatch-title");
    root.setAttribute("data-no-translate", "");
    host.append(root);

    // The artwork is a renderer-owned, bundled path, not a value in the public model.
    const art = typeof illustration === "string" && /^art\/[\w/-]+\.(?:webp|png|svg|jpe?g)$/i.test(illustration) ? illustration : null;
    let session;
    let view;
    const tr = (key, values = {}) => copy[session.lang][key].replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");

    function finish(reason) {
      if (!session) return;
      const { openedFrom, update, invoker } = session;
      session = null;
      if (root.open) root.close();
      if (invoker?.isConnected) invoker.focus({ preventScroll: true });
      if (openedFrom === "recap" && update && (reason === "acknowledged" || reason === "later")) onDismiss(reason);
    }

    root.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish("later");
    });
    root.addEventListener("keydown", (event) => {
      // Chromium's search input otherwise consumes Escape to clear its value first.
      if (event.key === "Escape" && event.target.type === "search" && !event.isComposing) {
        event.preventDefault();
        finish("later");
        return;
      }
      if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
      const nodes = [...root.querySelectorAll("button:not(:disabled), input:not(:disabled), summary, [tabindex='0']")]
        .filter((node) => node.getClientRects().length);
      const first = nodes.at(0), last = nodes.at(-1);
      if (!first) return;
      const active = doc.activeElement;
      if ((event.shiftKey && (active === first || !nodes.includes(active))) || (!event.shiftKey && active === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    });

    function acceptRelease(release) {
      return versionLabel(release?.version) && items(release.sections).some((section) => items(section?.entries).some(acceptEntry));
    }
    function acceptEntry(entry) {
      return typeof entry?.title === "string" && entry.title.trim();
    }
    function releaseRows() {
      const releases = items(session.model.releases).filter(acceptRelease);
      if (view === "history") return releases;
      const versions = session.update ? items(session.model.rangeVersions) : [session.model.toVersion];
      return releases.filter((release) => versions.includes(release.version));
    }
    function category(kind) { return categories.has(kind) ? tr(kind) : ""; }
    function platformKeys(entry) { return items(entry.platforms).filter((key) => platforms.has(key)); }

    function renderEntry(entry) {
      const node = el("li", "field-dispatch__entry");
      node.lang = "en"; // Bundled release notes are reviewed English, distinct from translated UI chrome.
      node.append(el("h5", "", entry.title));
      const labels = platformKeys(entry);
      if (labels.length) {
        const badges = el("div", "field-dispatch__badges");
        badges.lang = session.lang;
        for (const key of labels) badges.append(el("span", "field-dispatch__badge", tr(key)));
        node.append(badges);
      }
      if (entry.summary) node.append(el("p", "", entry.summary));
      const action = typeof entry.actionId === "string" && Object.hasOwn(actions, entry.actionId) ? actions[entry.actionId] : null;
      if (typeof action?.run === "function" && typeof action.label === "string" && action.label.trim()) {
        const control = button(action.label, () => { finish("action"); action.run(); }, "field-dispatch__action");
        control.lang = session.lang;
        node.append(control);
      }
      return node;
    }

    function renderChanges(target, status, rows, query) {
      const words = query.trim().toLocaleLowerCase(session.lang).split(/\s+/).filter(Boolean);
      const matches = (release, section, entry) => {
        if (!acceptEntry(entry)) return false;
        const names = platformKeys(entry);
        const input = [release.version, section.kind, category(section.kind), entry.title, entry.summary, ...names, ...names.map(tr)]
          .join(" ").toLocaleLowerCase(session.lang);
        return words.every((word) => input.includes(word));
      };
      let count = 0;
      target.replaceChildren();
      for (const [index, release] of rows.entries()) {
        const expandable = rows.length > 3;
        const group = el(expandable ? "details" : "article", "field-dispatch__release");
        const heading = el("h3", "field-dispatch__version", tr("release", { version: release.version }));
        if (expandable) {
          const summary = el("summary", "field-dispatch__version-summary");
          summary.append(heading);
          group.append(summary);
          group.open = index === 0 || words.length > 0;
        } else group.append(heading);
        for (const section of items(release.sections)) {
          const entries = items(section?.entries).filter((entry) => matches(release, section, entry));
          if (!entries.length) continue;
          const sectionLabel = category(section.kind);
          if (sectionLabel) group.append(el("h4", "field-dispatch__category", sectionLabel));
          const list = el("ul", "field-dispatch__entries");
          for (const entry of entries) list.append(renderEntry(entry));
          group.append(list);
          count += entries.length;
        }
        if (group.children.length > 1) target.append(group);
      }
      status.textContent = !count ? tr(words.length ? "noMatch" : "noNotes") : words.length ? tr("matches", { count }) : "";
    }

    function render({ focus = true } = {}) {
      const inHistory = view === "history";
      const { model, update } = session;
      const header = el("header", "field-dispatch__header");
      const decoration = el("div", "field-dispatch__illustration");
      decoration.setAttribute("aria-hidden", "true");
      if (art) {
        const img = el("img");
        img.alt = "";
        img.addEventListener("load", () => decoration.classList.add("field-dispatch__illustration--loaded"));
        img.src = new URL(art, rendererUrl).href;
        decoration.append(img);
      }
      const masthead = el("div", "field-dispatch__masthead");
      masthead.append(el("p", "field-dispatch__brand", tr("brand")));
      const title = el("h2", "field-dispatch__title", inHistory ? tr("history") : update
        ? tr("updated", { from: model.fromVersion, to: model.toVersion })
        : versionLabel(model.toVersion) ? tr("current", { to: model.toVersion }) : tr("brand"));
      title.id = "field-dispatch-title";
      title.tabIndex = -1;
      masthead.append(title);
      masthead.append(el("p", "field-dispatch__intro", tr(inHistory ? "historyIntro" : update ? "recapIntro" : "currentIntro")));
      header.append(decoration, masthead);

      const content = el("div", "field-dispatch__content");
      const rows = releaseRows();
      if (!inHistory) {
        const highlights = rows.flatMap((release) => items(release.sections).flatMap((section) => items(section?.entries)))
          .filter((entry) => acceptEntry(entry) && entry.highlight === true).slice(0, 3);
        if (highlights.length) {
          const list = el("ul", "field-dispatch__highlights");
          list.lang = "en";
          for (const entry of highlights) list.append(el("li", "", entry.title));
          content.append(el("h3", "field-dispatch__highlights-title", tr("highlights")), list);
        }
      }
      if (model.historyIncomplete === true) content.append(el("p", "field-dispatch__gap", tr("gap")));

      const status = el("p", "field-dispatch__status");
      status.setAttribute("role", "status");
      const results = el("div", "field-dispatch__results");
      if (inHistory || rows.length > 3) {
        const searchbar = el("div", "field-dispatch__search");
        const label = el("label", "", tr("search"));
        const input = el("input");
        input.type = "search";
        input.id = "field-dispatch-search";
        label.htmlFor = input.id;
        const refresh = () => renderChanges(results, status, rows, input.value);
        input.addEventListener("input", refresh);
        searchbar.append(label, input, button(tr("clear"), () => { input.value = ""; refresh(); input.focus(); }));
        content.append(searchbar);
      }
      content.append(status, results);
      renderChanges(results, status, rows, "");

      const footer = el("footer", "field-dispatch__footer");
      const switchTo = (next) => { view = next; render(); };
      if (inHistory && session.openedFrom === "recap") footer.append(button(tr("back"), () => switchTo("recap")));
      if (!inHistory) footer.append(button(tr("all"), () => switchTo("history")));
      if (session.openedFrom === "recap" && update) {
        footer.append(button(tr("later"), () => finish("later")), button(tr("gotIt"), () => finish("acknowledged"), "primary"));
      } else {
        footer.append(button(tr("close"), () => finish("later"), "primary"));
      }
      const scroll = el("div", "field-dispatch__scroll");
      scroll.append(header, content);
      root.replaceChildren(scroll, footer);
      if (focus) title.focus();
      return title;
    }

    function open(nextView, model, invoker, locale) {
      if (root.open || !root.isConnected) return false;
      session = {
        model: model || {}, openedFrom: nextView, invoker: invoker ?? doc.activeElement,
        lang: /^de(?:\b|DE)/i.test(locale ?? doc.documentElement.lang) ? "de" : "en",
        update: model?.status === "updated" && Boolean(versionLabel(model.fromVersion) && versionLabel(model.toVersion)),
      };
      view = nextView;
      root.lang = session.lang;
      const title = render({ focus: false });
      root.showModal();
      title.focus({ preventScroll: true });
      return true;
    }
    return {
      openRecap: (model, invoker, locale) => open("recap", model, invoker, locale),
      openHistory: (model, invoker, locale) => open("history", model, invoker, locale),
    };
  }
  return { create };
})();
