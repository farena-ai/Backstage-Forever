;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BFAcademyTankPack = factory();
})(globalThis, function () {
  'use strict';

  const lesson = Object.freeze({
    title: 'Tank lesson: Plan the first pull',
    scope: 'Offline group-play fundamentals and a fictional drill, not live advice or rules for a specific Forever build, class, or encounter.',
    preparation: 'Before the pull, agree on one pack, a starting signal, and a place to fight. Confirm the group is ready instead of assuming it is.',
    positioning: 'Pick a spot the group can see and reach without passing another pack. Check before moving the fight around a corner.',
    threat: 'Threat is one concept behind which player an enemy may focus. Seeing an enemy turn toward an ally does not tell you why it turned or what it will do next. Call out what you see rather than assuming a threat ranking.',
    defensive: 'Identify the danger you plan to cover and check whether your defensive will still be active when it arrives. Do not assume an ability or cooldown is available.',
    recovery: 'If the pull goes off plan, call out the change, keep the group in view, and avoid dragging the fight into another pack. Reconfirm the group’s readiness before the next pull.'
  });

  const drill = Object.freeze({
    id: 'tank-first-pull',
    title: 'First pull: Set up, hold position, recover',
    evidence: 'simulated',
    prompt: 'In this fictional room, the group has not confirmed readiness. You can bring one pack to an alcove your healer can see. The blind corner blocks that view, and crossing the far end draws a second pack. Once you signal and pull, a heavy swing lands on beat two. Your practice guard lasts only for the beat on which you use it. After the swing, one enemy heads toward an ally near the far end. Which plan fits those cues?',
    improvement: 'Before pulling, agree where the group will fight and what you will call out if the pull goes off plan.',
    options: Object.freeze([
      ['rush', 'Cross the far end and pull before the group is ready', 'You draw a second pack while the group has not confirmed readiness.'],
      ['blind-corner', 'Confirm readiness, then hold the pack behind the blind corner', 'The corner breaks sight between you and the healer before the heavy swing.'],
      ['guard-early', 'Confirm readiness, hold in the alcove, and use the guard on beat one', 'The guard expires before the heavy swing on beat two.'],
      ['chase', 'Confirm readiness, guard on beat two in the alcove, then chase to the far end', 'The chase leaves the agreed spot and draws the second pack.'],
      ['regroup', 'Confirm readiness and signal, hold in the alcove, guard on beat two, and call out the stray', 'You start with one pack in view of the healer, the guard covers the heavy swing, and you call out the stray without drawing the second pack.', true]
    ].map(([id, label, feedback, preferred = false]) => Object.freeze({ id, label, feedback, preferred })))
  });

  return Object.freeze({ lesson, drill });
});
