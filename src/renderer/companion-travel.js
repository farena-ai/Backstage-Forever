(function (root) {
  "use strict";
  const evidenceStates = new WeakMap();
  const esc = (value) => CompanionReply.escape(value);
  function publishers(travel, ids) {
    return [
      ...new Set(
        ids.map(
          (id) =>
            travel.sources.find((s) => s.id === id)?.publisher ||
            "Dated public reference",
        ),
      ),
    ]
      .map(esc)
      .join(", ");
  }
  function sourceScope(s) {
    return s.scope === "exact-build-observation"
      ? `Published community observation · build ${s.build} · observed ${s.observedOn}`
      : s.scope.includes("prelaunch")
        ? `General prelaunch guidance · published ${s.publishedOn}`
        : `General Forever guidance · published ${s.publishedOn}`;
  }
  function render(travel, index, text) {
    const t = travel;
    const road = t.options.find((o, i) => i > 0 && o.mode === "road");
    return `<section class="travel-result" data-travel-result>\
<h3>${esc(t.headline)}</h3>${road ? `<button type="button" class="travel-jump" data-travel-jump="${esc(road.id)}">\
<span aria-hidden="true">⌖</span> Show road guide</button>` : ""}\
${t.options.length ? '<p class="travel-condition">Conditional options · confirm availability in game. Unlocks, timing, costs and safety are unknown.</p>' : ""}<div class="travel-options">${t.options.map((o, i) => `<article class="travel-option" data-travel-option="${esc(o.id)}" tabindex="-1">\
<div class="eyebrow">${i === 0 ? "Start here" : "Alternative"} · ${esc(o.mode)}</div>\
<h4>${esc(o.title)}</h4>\
<ol>${o.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>\
<p class="corner-note">Reference ${publishers(t, o.sourceIds)}</p>${t.choiceToken ? `<button type="button" data-command="save-travel-plan" data-message-index="${index}" data-option-id="${esc(o.id)}">${o.saved ? "Saved to Plans" : "Save trip plan"}</button>` : ""}</article>`).join("")}</div>${t.claims.map((c) => `<p class="travel-claim">${esc(c.text)} <small>${publishers(t, c.sourceIds)}</small>\
</p>`).join("")}\
${t.cautions.length ? `<ul class="travel-cautions">${t.cautions.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}<p class="corner-note">${esc(t.coverage)}</p>${t.choiceToken ? `<div class="button-row">\
<button type="button" data-command="copy-travel" data-message-index="${index}">Copy full guidance</button>\
</div>` : `<details>\
<summary>Full guidance for copying</summary>\
<pre>${esc(text)}</pre>\
</details>`}\
${t.sources.length ? `<details class="travel-evidence" data-travel-evidence="${index}" ${evidenceStates.get(t) ? "open" : ""}>\
<summary>How we know</summary>\
<p class="corner-note">Dated public references, not a live service check. Saved source files are not independent authorities.</p>${t.sources.map((s) => `<article>\
<strong>${esc(s.publisher)} · ${esc(s.id)}</strong>\
<p>${esc(sourceScope(s))}<br>Reviewed ${esc(s.reviewedOn)}</p>${s.commit ? `<p class="corner-note">Source revision ${esc(s.commit)}</p>` : ""}<button type="button" data-command="open-travel-source" data-source-id="${esc(s.id)}">Open ${esc(s.publisher)} source</button>\
</article>`).join("")}</details>` : ""}</section>`;
  }
  function mounted(container, messages) {
    for (const button of container.querySelectorAll("[data-travel-jump]"))
      button.addEventListener("click", () => {
        const card = [
          ...button
            .closest("[data-travel-result]")
            .querySelectorAll("[data-travel-option]"),
        ].find((n) => n.dataset.travelOption === button.dataset.travelJump);
        if (card) {
          container.scrollTop +=
            card.getBoundingClientRect().top -
            container.getBoundingClientRect().top;
          card.focus({ preventScroll: true });
        }
      });
    for (const details of container.querySelectorAll(
      "[data-travel-evidence]",
    )) {
      const travel = messages[Number(details.dataset.travelEvidence)]?.travel;
      if (travel)
        details.addEventListener("toggle", () =>
          evidenceStates.set(travel, details.open),
        );
    }
  }
  root.CompanionTravel = { render, mounted };
})(globalThis);
