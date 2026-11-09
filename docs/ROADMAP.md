# Roadmap

## Implemented in the desktop preview

Local manual character profiles, notes and goals; optional explicit AI requests; Ollama/OpenAI/Anthropic/xAI adapters; isolated encrypted key storage; opt-in limited character context; data export/import/reset; offline operation and a Windows installer build path. See VALIDATION.md for actual test and build results; feature implementation is not proof of every deployment environment.

ChatGPT browser authentication and app-private official Claude Code subscription transport are implemented. Live interactive consent and paid inference acceptance remain unperformed; API fixture tests also do not certify live accounts. The ChatGPT preview stores one registration/account per installation, with reset required to switch.

The optional addon is an experimental manual-copy prototype with an interface placeholder. Structural tests check its constraints; in-client behavior remains unverified.

## Before a supported public release

Frank confirmed the public MIT repository `farena-ai/Backstage-Forever`; complete signing, clean-machine install/upgrade/uninstall and accessibility acceptance; verify any advertised provider access with authorized credentials; test the addon in the intended client and document exact interface/build evidence. No game API support is certified today.

## Later design work

An isolated Grok subscription inference adapter (official OAuth exists, but subscription mode is unavailable in this preview until tools/hooks isolation is verified); a versioned, validated manual addon-data import; richer quest/gear planning based on verified data sources; optional voice and intentional friend sharing; a signed updater only after ownership and release infrastructure are settled. These are planned work, not hidden working features. Combat computation, automated play and an unsupported live game bridge are outside this foundation. No release watcher jobs.
