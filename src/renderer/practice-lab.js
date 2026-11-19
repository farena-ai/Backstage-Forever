(() => {
  'use strict';
  const { drills, createAttempt, choose, retry } = window.BFPracticeLab;
  const byId = id => document.getElementById(id);
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
})();
