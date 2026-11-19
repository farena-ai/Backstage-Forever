window.PracticeLabView = (() => {
  'use strict';
  const { drills, createAttempt, choose, retry } = window.BFPracticeLab;
  function markup(standalone) {
    const heading = standalone ? 'h1' : 'h2';
    const drillHeading = standalone ? 'h2' : 'h3';
    return `<div class="practice-lab" data-practice-lab>
      <header>
        <p class="practice-lab-kicker">Class &amp; Role Academy</p>
        <${heading} id="practice-lab-title" tabindex="-1">Practice Lab</${heading}>
        <p class="practice-lab-muted">Try one decision at a time. These fictional drills use no live game data and do not measure your in-game performance.</p>
      </header>
      <div class="practice-lab-panel">
        <label for="drill-picker">Choose a drill</label>
        <select id="drill-picker"></select>
        <section aria-labelledby="drill-title">
          <p class="practice-lab-kicker practice-lab-badge">Simulated scenario</p>
          <${drillHeading} id="drill-title"></${drillHeading}>
          <p id="drill-prompt"></p>
          <div id="drill-options" role="group" aria-label="Choose an action" aria-describedby="drill-prompt"></div>
        </section>
        <section id="drill-result" aria-labelledby="result-title" hidden>
          <h3 id="result-title" tabindex="-1" aria-describedby="result-feedback result-improvement">Simulated result</h3>
          <p id="result-feedback"></p>
          <p id="result-improvement"><strong>One thing to practice:</strong> <span></span></p>
          <button id="drill-retry" type="button">Retry drill</button>
        </section>
      </div>
    </div>`;
  }

  function mount(host, { standalone = false, previous = null } = {}) {
    // Shell paints replace #app. Keep this in-memory exercise only while its route stays mounted.
    if (previous) {
      host.append(previous);
      return;
    }
    // Markup is static; the only interpolation chooses fixed heading tags.
    host.innerHTML = markup(standalone);
    bind(host.firstElementChild);
    if (!standalone) host.querySelector('#practice-lab-title').focus();
  }

  function bind(host) {
    const byId = id => host.querySelector(`#${id}`);
    const picker = byId('drill-picker');
    const options = byId('drill-options');
    const result = byId('drill-result');
    let attempt;

    function renderDrill() {
      const { drill } = attempt;
      result.hidden = true;
      byId('result-feedback').textContent = '';
      byId('result-improvement').querySelector('span').textContent = '';
      byId('drill-title').textContent = drill.title;
      byId('drill-prompt').textContent = drill.prompt;
      options.replaceChildren(...drill.options.map(option => {
        const button = document.createElement('button');
        button.type = 'button';
        button.id = `practice-action-${option.id}`;
        button.textContent = option.label;
        button.addEventListener('click', () => {
          const next = choose(attempt, option.id);
          if (next === attempt) return;
          attempt = next;
          const { feedback, improvement } = attempt.result;
          byId('result-feedback').textContent = feedback;
          byId('result-improvement').querySelector('span').textContent = improvement;
          result.hidden = false;
          byId('result-title').focus();
          for (const control of options.children) control.disabled = true;
          button.classList.add('chosen');
        });
        return button;
      }));
    }

    for (const drill of drills) picker.add(new Option(drill.title, drill.id));
    picker.value = drills[0].id;
    picker.addEventListener('change', () => {
      const next = createAttempt(picker.value);
      if (!next) return;
      attempt = next;
      renderDrill();
    });
    byId('drill-retry').addEventListener('click', () => {
      attempt = retry(attempt);
      renderDrill();
      options.firstElementChild.focus();
    });
    attempt = createAttempt(picker.value);
    renderDrill();
  }

  const standalone = document.querySelector('[data-practice-standalone]');
  if (standalone) mount(standalone, { standalone: true });
  return { mount };
})();
