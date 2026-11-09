# Backstage Forever desktop foundation

Backstage Coding • Designed by Frank Arena

## Goal and scope
Deliver an installable Windows-first 0.1.0 companion that friends configure independently. The desktop works without AI or an addon. This milestone includes real local profiles, goals and notes, four AI adapters, explicit sharing consent, encrypted API keys, onboarding, backup/import/delete controls, original vector graphics, an NSIS installer and a tested optional manual-export addon. No live combat advice, process inspection, key injection, automated play, or unsupported real-time game bridge.

## Approaches
Electron is selected: consistent polished GUI, mature Windows packaging and OS-backed secret encryption with one JavaScript toolchain. Tauri is smaller but requires another native toolchain; browser-only is easy to distribute but cannot provide equivalent key isolation and desktop packaging. No remote server or owner account is required.

## Architecture and contracts
Renderer uses local HTML/CSS/JavaScript, a strict CSP, no Node access, text-only AI output, and narrowly exposed preload methods. Main process owns validated persistence, encryption, network calls and native file dialogs. State schema version 1 contains profiles and provider preferences; credentials live separately and are never exported or returned to the renderer. Disk writes are atomic; invalid import must preserve existing data. All cloud endpoints are fixed HTTPS origins. Ollama accepts loopback HTTP only. Requests reject redirects, use timeout and bounded response size. No telemetry, background network calls or automatic cloud fallback. User sends one prompt intentionally; conversation is memory-only. Default no character context. Optional context preview includes name/class/level/realm only, never private notes or goals.

Public bridge: bootstrap() -> {state, providers, version, secretStatus}; saveState(state) -> state; saveProvider({provider,model,endpoint?,apiKey?}) -> {state,secretStatus}; deleteKey(provider); ask({provider,prompt,profileId?,shareProfile:boolean}) -> string; exportData(); importData() -> state|null; resetData() -> state|null; openLink(id). Main errors are safe user-readable messages, without raw remote errors or keys.

State: {schemaVersion:1,onboarded:boolean,profiles:[{id,name,realm,className,level,notes,goals:[{id,text,done}]}],activeProfileId:string|null,provider:{id:'ollama'|'openai'|'anthropic'|'xai',model:string,endpoint:string}}. providers metadata is [{id,name,endpoint,help}]. Blank model requires user selection; no invented current model promise.

## Interface
Original cartographic dark-fantasy art, ink navy, aged brass, warm ivory typography, teal status accents. A vertical navigation rail leads to Adventure, Characters, AI Companion, Connections and Field Guide. Dashboard uses real profile and goal counts with honest empty states. Guided first run asks for a profile then offers offline or AI setup. Keyboard focus, labeled inputs, reduced motion, readable contrast, scrollable layout and minimum 1000×700 window. No fabricated live game status or sample character disguised as real data.

## Compatibility evidence
On 2026-11-08 the local installation contains _forever_ and .build.info product wowf version 1.60.1.70862. Blizzard's Forever landing page is indexed but direct retrieval returned 403; third-party API claims are insufficient for certification. Optional Lua addon must remain experimental until tested in that client. Use a user-invoked out-of-combat export panel and GetBuildInfo interface evidence, no fabricated live link. Desktop profiles are manually entered and independently useful.

## Distribution and updates
Build local per-user NSIS installer and source ZIP. No GitHub publication until owner/repository confirmation. Candidate account found by authenticated gh is farena-ai; requested repository is Backstage-Forever. Initial update path is manual: download a newer signed installer from confirmed GitHub Releases and run it over existing installation. Automatic updates and signing remain explicit release gates, never simulated. No watcher jobs.

## Phases
1. Working desktop foundation and installer, with automated core/UI smoke tests (this milestone).
2. In-client addon verification, versioned import bridge and verified game-data sources; test all supported API capabilities before enabling them.
3. Signed public release, clean-machine acceptance, accessibility audit and release metadata; optional signed updater after owner/repository confirmation.
4. Voice, richer gear/quest planning and intentional friend sharing, each independently designed and validated.

## Acceptance
Tests exercise persistence validation, malformed imports, key isolation, provider protocols and response errors, privacy context and endpoint restrictions. Launch the real Electron application and test first-run, profile creation, goal toggle, navigation and persistence. Produce a local installer and record limitations. Live cloud access is tested only with user-supplied credentials; protocol fixtures are clearly identified as fixtures. Never claim game, signing, or clean-machine checks passed when they have not run.
