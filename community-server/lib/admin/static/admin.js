// Backstage Desk admin area: the one script. Small conveniences only; every
// page works without it. It never builds HTML from text (textContent only).
(function () {
  "use strict";

  // "Are you sure?" on buttons that carry data-confirm.
  document.addEventListener("click", function (e) {
    var b = e.target instanceof Element ? e.target.closest("[data-confirm]") : null;
    if (b && !window.confirm(b.getAttribute("data-confirm"))) e.preventDefault();
  });

  // Saved replies: picking one puts its text into the reply box.
  document.querySelectorAll("select[data-saved-for]").forEach(function (sel) {
    sel.addEventListener("change", function () {
      var box = document.getElementById(sel.getAttribute("data-saved-for"));
      if (!box || !sel.value) return;
      box.value = box.value.trim() ? box.value.replace(/\s+$/, "") + "\n\n" + sel.value : sel.value;
      sel.selectedIndex = 0;
      box.focus();
    });
  });

  // Announcement form: live preview.
  var form = document.querySelector("form[data-preview-form]");
  var card = document.getElementById("ann-preview");
  if (form && card) {
    var put = function () {
      var get = function (n) { return form.elements[n] ? String(form.elements[n].value) : ""; };
      var set = function (key, value) { var el = card.querySelector('[data-preview="' + key + '"]'); if (el) el.textContent = value; };
      var warn = get("level") === "warning";
      card.classList.toggle("warn", warn);
      card.classList.toggle("info", !warn);
      set("level", warn ? "Warning" : "From the team");
      set("title", get("title") || "Title");
      set("text", get("text") || "Text");
      set("link", get("link"));
    };
    form.addEventListener("input", put);
    form.addEventListener("change", put);
  }

  // Charts: a crosshair and a small tooltip for the column under the pointer.
  var tip = null;
  var hide = function (svg) {
    if (tip) tip.hidden = true;
    var c = svg.querySelector(".cross");
    if (c) c.classList.remove("on");
  };
  document.querySelectorAll("svg.plot").forEach(function (svg) {
    svg.addEventListener("pointermove", function (e) {
      var hit = e.target instanceof Element ? e.target.closest(".hit") : null;
      if (!hit) { hide(svg); return; }
      if (!tip) { tip = document.createElement("div"); tip.className = "tip"; tip.setAttribute("role", "status"); document.body.appendChild(tip); }
      tip.textContent = hit.getAttribute("data-tip") || "";
      tip.hidden = false;
      var w = tip.offsetWidth, x = e.clientX + 14, y = e.clientY + 14;
      if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
      tip.style.left = Math.max(8, x) + "px";
      tip.style.top = Math.min(window.innerHeight - tip.offsetHeight - 8, y) + "px";
      var c = svg.querySelector(".cross");
      if (c) { c.setAttribute("x1", hit.getAttribute("data-x")); c.setAttribute("x2", hit.getAttribute("data-x")); c.classList.add("on"); }
    });
    svg.addEventListener("pointerleave", function () { hide(svg); });
  });
})();
