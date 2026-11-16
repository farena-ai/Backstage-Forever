# The Forever companion

Backstage Forever is permanently specialized for **World of Warcraft: Forever**, played in Blizzard's dedicated client. Every question in the companion screen assumes that game. The assistant should never ask which game “Forever” means.

Use it for class and leveling choices, zone and quest planning, dungeon preparation, professions, gear principles and group plans outside combat. Macro and addon setup/configuration can be discussed; the companion cannot execute code. It does not control inputs, inspect game processes or memory, make live combat decisions, automate farming or bypass anti-cheat.

## Automatic local guidance

Adventure builds a deterministic plan from your saved observed quest log without calling a provider. Session/focus controls save per character. Each step retains its reported source and save timestamp. Turn-ins and unfinished objectives can be prioritized, but unobserved prerequisites, NPCs and routes are not invented. Explain my plan drafts a public quest question for review; you still choose whether to send it. Equipment/bag preparation details stay local and are excluded from automatic provider context. See [Guidance](GUIDANCE.md).

## Understanding what you ask (0.58)

Before anything else, the companion works out what you actually want and answers from WoW Forever's own data. It understands everyday phrasing: "wheres voljin at", "where is mankriks wife", "the gryphon guy in westfall", "who drops sharptalon's claw", "need food near sentinel hill", "take me to Booty Bay", plus misspellings, possessives and roleplay greetings.

| You ask about | It answers from |
|---|---|
| A person by name or by job (innkeeper, flight master, auctioneer, banker, weapon master) | NPC positions, with town and zone ("Sentinel Hill, Westfall") |
| A class or profession trainer | Trainer observations, filtered to your faction; neutral towns serve both |
| Where to buy something | Vendor listings, nearest friendly seller first, or the town you name |
| Where an item comes from, or what a creature drops | Loot and boss loot, plus the quest the item is for |
| A quest by name, or where to turn it in | Quest givers, objectives, objective area and turn-in |
| A dungeon or raid | Zone, level range, entrance and bosses; whether your level fits |
| Getting somewhere | The travel planner first (flights, zeppelins, boats, tram), else your nearest flight master |

With no AI model chosen, these answers come straight from the data. With a model, the same verified facts go into its context, headed "Verified WoW Forever facts for this question", so it can answer in voice while using exactly those names, places and numbers. When the data doesn't have something, the companion says so instead of guessing.

**Voice.** The model is a seasoned fellow adventurer. Write in character ("Lok'tar ogar!", "*bows*", "Greetings, traveller") and it answers in character, true to your race, faction and class. Otherwise it speaks plainly with a little of the world's flavour. It uses your character's name and, when the addon has recorded it, the right pronouns.

**Refusals.** Gold duping, speed or teleport hacks, AFK farm bots and getting into someone else's account are declined with a short reason and an honest alternative.

### The benchmark

`tests/fixtures/companion-bench/questions.json` holds 100 real player questions, balanced between Horde and Alliance. Each one's expected facts were checked against the bundled data, and each entry cites its evidence. `node scripts/companion-bench.cjs` asks every question exactly as the app would, offline, and reports:

- **covered:** answered correctly without a model, or the model receives the needed facts;
- **correct locally:** answered correctly with no model;
- **understood:** the request was routed to the right kind of answer.

`--fails` lists what is still wrong. Coordinates match within 0.6, because positions are approximate. Roleplay questions with nothing factual to check are judged on voice, which needs a live model, so they are reported separately. `tests/companion-bench.test.cjs` keeps the scores from going backwards.

| Version | Covered | Correct locally | Understood |
|---|---|---|---|
| 0.57 | 15% | 5% | 19% |
| 0.58 | 96.9% | 93.8% | 99% |
| 0.59 | 97.9% | 94.8% | 99% |

**Held-out set.** `tests/fixtures/companion-bench/heldout.json` has 60 more questions, written by someone who never saw the companion's code: slang, abbreviations, run-on sentences, roleplay. This measures whether improvements generalize instead of fitting the first set. Run it with `node scripts/companion-bench.cjs --set heldout`.

| Version | Covered | Correct locally | Understood |
|---|---|---|---|
| 0.58 | 56.7% | 46.7% | 61.7% |
| 0.59 | 100% | 90% | 91.7% |

0.59 added what the held-out set showed was missing:
- slang ("zep", "xroads", "uc", "lvl", "hang out", "who has it", "do mobs drop em");
- names found from one distinctive word ("the apothecary dude, helbrim");
- trips with a stated start ("to tb from xroads"), walking distance inside a zone, and transports that belong to the other faction;
- weapon masters by weapon ("who teaches guns");
- quests found by the items you carry ("got all 15 centaur bracers, who wants them?");
- where quest targets were seen ("where are the outrunners");
- the right quest among same-named ones;
- recipe skill ranks;
- gathering spots.

## Local NPC reference

Ask an NPC location by full name, a unique short name, or exact **NPC #ID**. Recognized names and explicit NPC questions are handled locally before model/key/provider access; no AI account is needed. Ambiguous names ask for an exact ID, and unknown/unavailable evidence stays unknown. Ordinary material, item, bank and geography questions retain their existing planning path.

The resolver prefers compatible observed-build points, then a separate historical reference containing 616 NPCs and 758 interaction points from Forever build 1.60.1.70790. Answers retain build, per-NPC lastSeen, source and approximate/non-live qualifications. Cairne's historical Thunder Bluff point around 59.9, 51.7 was last observed November 5, 2026; the file's November 9–11 collection dates do not change that observation. Asking where in Orgrimmar he is does not prove his presence there. No automatic route, waypoint or game action is created.

A direct **I'm already in Org** statement can supply a user-reported planning city for the retained conversation. The preview shows that source and keeps the old saved location separate; old mine coordinates are never attached to a newly reported city. Reports expire with their retained turn (at most six exchanges) and clear with existing character/provider/source/sharing/memory/clear boundaries. Failed/cancelled questions cannot retain a new report. Quotes, past/future/hypothetical statements, AI replies and saved memory cannot create one. Sharing off omits automatic character context. Desktop location remains last saved even if its timestamp is today; native Compass updates inside the game.

## Character context and honest uncertainty

0.6 adds bounded relevant Forever reference facts to the shared approved context: compatible exact-ID quest links, NPC/reference coordinates, listed rewards, chain status and source provenance. The same whitelist supplies the visible preview and every provider route. Character-sharing opt-out applies to these facts too. Full completed-ID sets and full reference packs remain local. The AI can explain supplied evidence, but its own answer does not establish a new verified quest fact. Local Quest Guide remains usable without a model.

The active-character preview shows the selected context used for a question; players can opt out. Only approved public character fields, bounded observed quests/objectives and actual destinations, XP, up to 10 recent observed turn-ins and optional completed-count belong in the request. The preview shows the approved payload; up to 10 quests and 3 objectives per quest are shared. A local dashboard and optional in-game Compass use observed data without inference. Recent history is a bounded tracking window, not a complete quest history or verified quest-guide database. Race and faction come from separate public game APIs; unfamiliar races are accepted without guessing a faction. Saved snapshots arrive through the addon's normal logout/UI-reload write cadence, so their timestamp matters: a saved zone or level is not a live observation. Private notes/goals are untrusted and excluded by default. Account identifiers, GUIDs, machine paths and credentials do not belong in automatic context.

A read-only public preview can also name another stored character without selecting it. That preview contains the named character's approved saved facts; neither the selected character's retained location report nor a location report typed in its current question transfers to another character. Inspecting a preview never changes selection, conversation or memory. Sending questions and using memory continue to require the selected character.

The assistant knows which game this is. It may not know a specific Forever quest, item or patch rule. It must explain uncertainty about that fact instead of inventing equipment, quest progress, location or a verified quest database. General WoW guidance should be labeled when Forever-specific behavior is unverified.

Example interaction:

> Player: Where should I level?
>
> Companion: Your saved snapshot shows level 24 in the Barrens; check its timestamp, since you may have moved since that save. Let's start with the quests in your saved log and their compatible reference details. If a quest's location or prerequisite is missing, I'll say so. Would you prefer solo questing or dungeon preparation?

The character details above are illustrative, not real imported data. Without approved context, the companion can ask for class, level and current zone while offering a useful general approach. It should not ask which game you mean.

## Enforcement and limits

`src/core/wow-policy.cjs` owns the shared `INSTRUCTION` for all provider backends and `scopeResponse(prompt)`. The parent request handler calls the gate on the raw user question before provider execution, so obvious unrelated requests such as “Write a Python web server,” “Build a React app,” weather questions, real-world recipes and essays receive a local friendly game-scope response without paid inference. Mentioning WoW does not turn a separate general software project into companion work.

The gate is a conservative English intent heuristic, not a complete semantic classifier or a security boundary. Ambiguous and implicit MMO questions pass to the provider under the shared instruction; ordinary names such as Python (a serpent pet) or React (a character) are not forbidden keywords. Novel phrasing, other languages and mixed intent can evade simple matching. Provider behavior is probabilistic, and tests validate the local gate and instruction contract rather than guaranteeing every model response. Architectural absence of tool/game-control execution is required independently of the prompt.

Verify with `node --test tests/wow-policy.test.cjs`.

## Local reference lookups (tool-using AI)

AI questions can now look things up while answering instead of relying only on the context sent with the question. The model may call seven read-only local lookups: **find_npc**, **search_quests**, **get_quest** (objective NPCs are resolved to locations), **find_item** (observed sources and vendors), **plan_travel**, **get_character** (only when *Use my active character* is on) and **quest_waypoint** (prepares a `/bf guide` command for you to paste). They read the same bundled, source-labelled Forever packs as the rest of BF. They cannot act in the game, reach the internet, read files or see private notes, goals or memory. Each question allows at most 10 lookups over 5 rounds, and the last round always produces a text answer.

Answers that used lookups are labelled **Companion · AI with local reference lookups** and list what was checked. Supported transports: OpenAI, Anthropic and xAI APIs, Ollama and Ollama Cloud, the ChatGPT plan, and the Claude subscription (an in-process lookup server only; no built-in Claude Code tools). A model that rejects tool definitions is retried once as a plain question, using the same provider and model. Larger models (about 27B and up, or cloud models) use lookup results more reliably than small local models.
