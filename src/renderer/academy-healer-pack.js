;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BFAcademyHealerPack = factory();
})(globalThis, function () {
  'use strict';

  const lesson = Object.freeze({
    title: 'Healer lesson: Plan for the next two hits',
    scope: 'Fictional practice only. The timing, costs and effects are invented, not live guidance or WoW Forever spell data.',
    preparation: 'Before the pull, check your mana, agree when to pause for a drink, and check which effects your own spells can dispel.',
    triage: 'Judge urgency by what will happen before your next action, not by who has the lowest health. Use an efficient heal when it is enough; spend more when only the emergency heal can cover the imminent hit.',
    manaAndDispels: 'Keep enough mana for the next necessary action. A dispel matters when it removes an effect you can actually clear before that effect does harm.'
  });

  const drill = Object.freeze({
    id: 'healer-mana-triage',
    title: 'Healer: Survive the hit, then stop the effect',
    evidence: 'simulated',
    prompt: 'You have 6 practice mana, no regeneration, and one action per beat before damage lands. An ally at 30% health will take a hit for 40 percentage points on beat one. The rest of the group is safe on beat one. On beat two a removable effect on another ally will deal lethal damage even at full health unless you dispel it. The hit and the effect are separate. An efficient heal restores 10 points for 2 mana; an emergency heal restores 25 for 3; a group heal restores 25 to each ally for 5. The dispel costs 2 mana and removes only the effect.',
    improvement: 'Before you spend mana, name the first deadline and reserve enough for the next one.',
    options: Object.freeze([
      Object.freeze({
        id: 'efficient-first', label: 'Use the efficient heal first', preferred: false,
        feedback: 'The efficient heal raises health to 40%. The 40-point hit leaves 0% health. Saving mana does not help if the first heal falls short.'
      }),
      Object.freeze({
        id: 'dispel-first', label: 'Dispel the removable effect first', preferred: false,
        feedback: 'The dispel prevents the later tick, but the separate first hit still drops the ally at 30%. The two threats have different deadlines.'
      }),
      Object.freeze({
        id: 'emergency-then-dispel', label: 'Use the emergency heal, then dispel on beat two', preferred: true,
        feedback: 'The ally survives the hit at 15% health. The dispel stops the lethal tick before it lands, and 1 mana remains.'
      }),
      Object.freeze({
        id: 'group-first', label: 'Use the group heal first', preferred: false,
        feedback: 'The ally survives the hit, but the group heal leaves only 1 mana. You cannot afford the 2-mana dispel before the lethal tick.'
      })
    ])
  });

  return Object.freeze({ lesson, drill });
});
