# Optional Forever account roster: research, not a shipped connection

Checked 2026-11-09. BF 0.5 does not offer Battle.net sign-in or promise a complete first-run roster. The addon learns detailed character state when each toon is played and exported normally. Existing local character folders are incomplete discovery hints, not authoritative profiles.

## Evidence

The author of the MIT blizzard_api client reports a Forever account profile using user-scoped OAuth, plus realmless character/profile/media routes. Its current README explicitly says Forever endpoints remain undocumented and reports that low-level characters may be absent and account data delayed. These are the implementer's primary reports, not an official Blizzard support commitment or tests performed by BF.

- https://github.com/Pinta365/blizzard_api#readme
- https://us.forums.blizzard.com/en/blizzard/t/wow-forever-api-what-works-so-far-plus-a-ts-client/60334

The README's client configuration uses an application client ID and secret; account data requires a distinct user authorization flow. This does not establish a secure supported public-desktop-client registration route. A distributed installer cannot keep a bundled application secret confidential.

## Gate before implementing account linking

1. Verify supported Forever account endpoints/scopes and official authorization requirements against a registered application.
2. Establish a supported native authorization flow or a minimal confidential exchange service with documented privacy and token handling; never embed the application's secret in the installer.
3. Test real user consent without automating login, account/region selection, expiry/refresh/revocation, disconnect/deletion and encryption.
4. Model name/surname/ruleset/source identity using proven Forever semantics; never overwrite existing realm values or merge player journals on guesses.
5. Reconcile API and addon observations by source and freshness, retain missing toons, label incomplete profiles and handle older account data without level/progress rollback.

No account passwords, browser-session cookies, client secrets, real tokens or provider credentials are part of this research. Local addon mode remains the default and requires no online account connection.
