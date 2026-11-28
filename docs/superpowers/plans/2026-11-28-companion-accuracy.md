# Forever Companion accuracy implementation

1. Reproduce the reported wording through `tests/travel-companion.test.cjs`. Test ordinary variations, the on-foot follow-up and uncovered travel.
2. Update `src/core/travel.cjs` and `travel-companion.cjs`, then compile the sourced roads from `travel-sources.cjs` using the existing immutable pack workflow.
3. Exercise `companion-service.cjs` with a configured provider that would return a wrong answer. Keep sourced direct answers local and test item, quest, NPC and trainer questions alongside advisory prompts.
4. Run the travel data checks, offline Companion benchmark and native Companion tests. Compare results with the original benchmark and keep source gaps visible.
