# Now Quest Flow Implementation Plan

> **For agentic workers:** Use the test-driven development and subagent-driven development skills for the independent pieces. Steps use checkbox syntax for tracking.

**Goal:** Make BF choose and explain practical next stops from current character evidence.

**Architecture:** Rank and reconcile in the main process. The desktop renders the same recommendation and temporary quest loop in Now, Mini Now and World Map. Desk reviews the player's explicit missing-location draft.

**Tech Stack:** Node, Electron IPC, existing renderer HTML and CSS, Node test runner and native smoke tests.

- [x] Test and implement proximity, pinned-goal and evidence ranking with stable ties.
- [x] Test and implement same-zone quest loops with positive completion evidence and character ownership.
- [x] Integrate the planner with Now, Mini Now and the map. Verify map evidence and keyboard access.
- [x] Add Desk draft validation, explicit review and moderator grouping. Verify with a local stub service.
- [ ] Run focused suites and production release checks. Verify the signed public Windows update path.
