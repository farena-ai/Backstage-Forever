const assert = require("node:assert/strict");

// Inspect the actual Chromium cascade, including native menu rows. A transparent
// option surface is unsafe: the platform popup may paint a light system color.
async function assertSelectContrast(page, context) {
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme });
    const controls = await page.locator("select").evaluateAll((selects) => {
      const color = (value) => value.match(/[\d.]+/g).map(Number);
      const luminance = (rgb) => rgb.slice(0, 3).map((n) => {
        const v = n / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      const inspect = (node) => {
        const style = getComputedStyle(node);
        const foreground = color(style.color), background = color(style.backgroundColor);
        const levels = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
        return {
          text: node.label || node.textContent,
          foreground: style.color,
          background: style.backgroundColor,
          backgroundLuminance: luminance(background),
          opaque: background.length === 3 || background[3] === 1,
          contrast: (levels[1] + 0.05) / (levels[0] + 0.05),
          disabled: node.disabled || node.parentElement?.disabled || false,
          selected: Boolean(node.selected),
        };
      };
      return selects.map((select) => ({
        name: select.getAttribute("aria-label") || select.name || select.id,
        appearance: getComputedStyle(select).appearance,
        colorScheme: getComputedStyle(select).colorScheme,
        control: inspect(select),
        rows: [...select.querySelectorAll("option, optgroup")].map(inspect),
      }));
    });
    assert.ok(controls.length, `${context}: expected native selects`);
    for (const select of controls) {
      const label = `${context}/${colorScheme}/${select.name}`;
      assert.notEqual(select.appearance, "none", `${label}: retain the native keyboard control`);
      assert.match(select.colorScheme, /dark/, `${label}: native popup must request dark system colors`);
      for (const row of [...select.rows, select.control]) {
        assert.ok(row.opaque, `${label}/${row.text}: menu surface must be opaque, got ${row.background}`);
        assert.ok(row.contrast >= (row.disabled ? 3 : 4.5), `${label}/${row.text}: text contrast ${row.contrast.toFixed(2)} is unreadable`);
      }
      const chosen = select.rows.find((row) => row.selected && !row.disabled);
      const other = select.rows.find((row) => !row.selected && !row.disabled);
      if (chosen && other) {
        const levels = [chosen.backgroundLuminance, other.backgroundLuminance].sort((a, b) => a - b);
        assert.ok((levels[1] + 0.05) / (levels[0] + 0.05) >= 3, `${label}: selected menu row needs a clearly contrasting surface`);
      }
    }
  }
}

module.exports = { assertSelectContrast };
