window.PracticeLabView = (() => {
  'use strict';
  const { drills, lessons, createAttempt, choose, retry } = window.BFPracticeLab;
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
        <section id="drill-lesson" aria-labelledby="drill-lesson-title" hidden></section>
        <section aria-labelledby="drill-title">
          <p class="practice-lab-kicker practice-lab-badge">Simulated scenario</p>
          <${drillHeading} id="drill-title" tabindex="-1"></${drillHeading}>
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
      ${standalone ? '' : '<button id="fieldbook-return" type="button" data-fieldbook-instance="dm" data-fieldbook-drill="opener" hidden>Back to Deadmines Fieldbook</button>'}
    </div>`;
  }

  function mount(host, { standalone = false, previous = null, fieldbook = null } = {}) {
    // Shell paints replace #app. Keep this in-memory exercise only while its route stays mounted.
    if (previous) host.append(previous);
    else {
      // Fixed markup; drill copy is set separately through textContent.
      host.innerHTML = markup(standalone);
      bind(host.firstElementChild, fieldbook?.drillId);
    }
    if (standalone) return;
    const back = host.querySelector('#fieldbook-return');
    const picker = host.querySelector('#drill-picker');
    back.hidden = !fieldbook;
    picker.disabled = Boolean(fieldbook);
    back.onclick = fieldbook ? () => {
      if (!back.hidden && back.isConnected && picker.value === back.dataset.fieldbookDrill)
        fieldbook.returnToPlan(back.dataset.fieldbookInstance, back.dataset.fieldbookDrill);
    } : null;
    if (!previous) {
      const heading = host.querySelector(fieldbook ? '#drill-title' : '#practice-lab-title');
      heading.focus();
      if (fieldbook) heading.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }

  function bind(host, initialDrill) {
    const byId = id => host.querySelector(`#${id}`);
    const picker = byId('drill-picker');
    const options = byId('drill-options');
    const result = byId('drill-result');
    let attempt;

    function renderDrill() {
      const { drill } = attempt;
      const lesson = Object.hasOwn(lessons, drill.id) ? lessons[drill.id] : null;
      const lessonRegion = byId('drill-lesson');
      lessonRegion.hidden = !lesson;
      lessonRegion.replaceChildren();
      if (lesson) {
        const { title, scope, ...sections } = lesson;
        const heading = document.createElement(host.querySelector('#drill-title').localName);
        heading.id = 'drill-lesson-title';
        heading.textContent = title;
        lessonRegion.append(heading, ...[scope, ...Object.values(sections)].map((text, index) => {
          const paragraph = document.createElement('p');
          if (index === 0) paragraph.className = 'practice-lab-muted';
          paragraph.textContent = text;
          return paragraph;
        }));
      }
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
    picker.value = createAttempt(initialDrill) ? initialDrill : drills[0].id;
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
