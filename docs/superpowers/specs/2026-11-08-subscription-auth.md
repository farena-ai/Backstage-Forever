# Subscription authentication amendment

Owner requests subscription/OAuth access as well as API keys. Owner confirmed public MIT repository farena-ai/Backstage-Forever. No credentials may be scraped from browsers or copied from other tools.

## Provider design
OpenAI: use official Sign in with ChatGPT open-source dynamic registration. System browser, loopback callback, PKCE S256, state, nonce, OIDC signature/issuer/audience/expiration/nonce verification, explicit plan-use scope, encrypted main-only tokens, refresh rotation and logout/revocation. Never silently fall back to API billing. Source: https://developers.openai.com/siwc/token-sharing-open-source/sign-in and profiles-and-sessions.

Anthropic: official unmodified, user-installed Claude Code tool handles its own login and subscription credentials. Do not extract, copy or replay its OAuth tokens. Child process has no tools, MCP servers, hooks, skills or session persistence, and an isolated empty working directory. Clear environment credentials that could silently select API billing. User chooses subscription mode, explicitly signs in through official tool, and can sign out there. Anthropic current official guidance: https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan and https://code.claude.com/docs/en/legal-and-compliance.

xAI: official Grok CLI OAuth exists. Its inference path still exposes MCP meta-tools and managed hooks; a sufficiently isolated adapter has not been verified. Keep API mode usable, clearly show subscription unavailable in this preview, and retain this integration on the roadmap. No cookie/session-token extraction or subscription impersonation.

## Integration
Extend state.provider with optional authMode ('api' or 'subscription'), defaulting existing records to API. Ollama remains local. New bridge subscriptionStatus() returns sanitized per-provider states; connectSubscription(provider) opens official auth flow on click only; disconnectSubscription(provider) clears/revokes only app-owned credentials or explicitly logs out official tool; ask routes by explicit mode. bootstrap also returns subscriptionStatus. No tokens or raw auth output returned to renderer. Plain profile backups include auth preference only, never credentials. Reset invalidates pending auth and clears app-owned ChatGPT tokens and Claude private directories; global tool profiles remain independent.

## Tests and release gates
Fixture tests for authorization state/PKCE/nonce, failed identity/scope/refresh, token storage exclusion, exact inference routing and child process restrictions. UI tests exercise explicit mode switching, no fallback, delayed reply reset/import invalidation and bad input recovery. Real account consent is user interactive and cannot be marked validated from fixture tests alone.
