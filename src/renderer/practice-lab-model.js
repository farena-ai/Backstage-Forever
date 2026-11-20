;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./academy-tank-pack.js'), require('./academy-healer-pack.js'));
  else root.BFPracticeLab = factory(root.BFAcademyTankPack, root.BFAcademyHealerPack);
})(globalThis, function (tank, healer) {
  'use strict';

  function drill(id, title, prompt, improvement, options) {
    return Object.freeze({ id, title, prompt, improvement, evidence: 'simulated', options: Object.freeze(
      options.map(([id, label, feedback, preferred = false]) => Object.freeze({ id, label, feedback, preferred }))
    ) });
  }

  const drills = Object.freeze([
    drill('opener', 'Plan an opener',
      'Your group has agreed to start on the tank’s signal. The target is not engaged, but you have time to get into position.',
      'Use the time before the signal to pick your target and get into position.', [
        ['start', 'Attack before the signal', 'You begin the exercise before the rest of the group is ready.'],
        ['ready', 'Get into position and wait for the signal', 'You are ready to act when the group starts together.', true],
        ['wait', 'Wait for the signal before moving into position', 'You respect the signal, but spend the opening moments getting into position.']
      ]),
    drill('resource', 'Spend or save?',
      'You have 5 practice energy. An optional action costs 3 now; your planned next action costs 4. You will not regain energy between actions.',
      'Before spending, check what the next planned action costs.', [
        ['spend-now', 'Spend 3 energy now', 'You spend the reserve and cannot afford the planned action on the next beat.'],
        ['hold', 'Save the energy for the next action', 'You keep enough energy for the planned action.', true]
      ]),
    drill('defensive', 'Time a defensive',
      'A heavy hit is two beats away. A practice guard reduces damage only on the beat you use it.',
      'Match the guard’s active window to the expected hit.', [
        ['early', 'Use the guard now', 'The guard expires before the heavy hit.'],
        ['impact', 'Use the guard on the beat the hit lands', 'The guard is active when the heavy hit lands.', true],
        ['late', 'Use the guard after the hit', 'The heavy hit lands before the guard is active.']
      ]),
    drill('triage', 'Choose a heal target',
      'One ally is at 45% health and safe for the next beat. Another is at 60% and about to take a hit for 70% of their maximum health. Your one practice heal restores 20 percentage points before the hit.',
      'Check incoming danger as well as current health when choosing whom to heal.', [
        ['lowest', 'Heal the ally at 45%', 'The safer ally recovers, but the incoming hit still exceeds the other ally’s health.'],
        ['incoming', 'Heal the ally about to take the hit', 'The incoming hit leaves the healed ally at 10% health.', true]
      ]),
    tank.drill, healer.drill
  ]);

  const lessons = Object.freeze({ [tank.drill.id]: tank.lesson, [healer.drill.id]: healer.lesson });

  function createAttempt(drillId) {
    const scenario = drills.find(entry => entry.id === drillId);
    return scenario ? Object.freeze({ drill: scenario, result: null }) : null;
  }

  function choose(attempt, optionId) {
    if (!attempt || attempt.result) return attempt;
    const option = attempt.drill.options.find(entry => entry.id === optionId);
    if (!option) return attempt;
    return Object.freeze({ ...attempt, result: Object.freeze({
      evidence: attempt.drill.evidence, preferred: option.preferred,
      feedback: option.feedback, improvement: attempt.drill.improvement
    }) });
  }

  function retry(attempt) {
    return createAttempt(attempt?.drill.id);
  }

  return Object.freeze({ drills, lessons, createAttempt, choose, retry });
});
