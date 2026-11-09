# AI provider setup

AI is optional and is only requested when you press Send. Pick a provider and explicitly enter a model available to your account or local installation. No default model is represented as universally available. Saving settings does not prove live access.

## Ollama (local)

Install and start Ollama separately. Download a model using Ollama's own tools, then enter the exact installed model name in Connections. The usual local endpoint is `http://127.0.0.1:11434`; a custom endpoint must use loopback HTTP. Remote hosts, LAN addresses and cloud endpoints are rejected for this adapter. Ollama must be running and the model must be installed. Local model speed and memory needs depend on your hardware. The app does not install Ollama or download models for you.

## OpenAI API

Create an API key in your OpenAI API account, confirm account billing/access and enter that key under OpenAI. Enter a model identifier your API account can use. Requests use the fixed OpenAI HTTPS endpoint; the app does not accept a custom cloud URL.

## Anthropic API

Create an Anthropic API key, verify API billing/access, and choose a model identifier available in that account. Save under Anthropic. Requests use the fixed Anthropic HTTPS endpoint and the Messages API protocol.

## xAI API

Create an xAI API key and verify billing/access, then save the key and an available model identifier under xAI. Requests use the fixed xAI HTTPS endpoint.

## Subscriptions and cost

A ChatGPT or Claude chat subscription is not an API key. Choose API or subscription mode deliberately: API access is authenticated and billed separately; subscription mode uses its own official authentication route and account limits. No subscription, trial credit or free allowance is assumed to cover API-mode requests. Check the provider's own account console for current account-specific credits, limits, model access and costs before sending. Each friend supplies their own credentials; never bundle yours with an installer.

Keys are encrypted locally using Electron safeStorage in a separate credentials file, handled only by the desktop main process. The app does not display keys back to the interface or put them in backups. If secure storage is unavailable, key saving must fail rather than fall back to plaintext. Delete a key through Connections; revoke it in the provider console if exposed.

## Troubleshooting

For connection failures, check that the selected model is spelled exactly, the local service is running or the API account has access and billing, then retry deliberately. The app does not silently switch providers. Error messages deliberately omit remote diagnostic bodies to avoid exposing credentials. Provider fixture tests prove request/response handling against fixtures only; live authenticated access has not been proven without supplied credentials.

## Primary references (reviewed 2026-11-08)

Direct documentation retrieval succeeded for [Ollama Chat](https://docs.ollama.com/api/chat), [OpenAI text generation](https://developers.openai.com/api/docs/guides/text), [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create) and [xAI Chat Completions](https://docs.x.ai/developers/rest-api-reference/inference/chat-completions). Documentation availability does not certify a particular account or model. Check these providers for current details.

## ChatGPT subscription mode

Select OpenAI and subscription authentication, then Connect. The app opens official Sign in with ChatGPT in your system browser. Review the actual account, requested access and consent; cancel if they are not what you intended. Return to the app after completion and check its connection status before sending. Choose an available model explicitly. This route uses app-owned tokens and does not read another tool's session. API keys are a separate selectable mode; a subscription error does not silently switch to API billing. Disconnect removes/revokes app-owned credentials as supported by the flow. This preview saves one ChatGPT registration/account per installation. To switch accounts, export your profiles if needed, then reset app data and connect the other account; reconnect other providers afterward. Disconnecting alone does not create a new registration. Live interactive consent and paid inference acceptance have not been performed; fixtures are not proof of account eligibility.

## Claude subscription mode

1. Install the official native Windows Claude Code executable yourself from [Anthropic's setup instructions](https://code.claude.com/docs/en/setup). The app does not bundle, modify or install it. Discovery checks your home `.local/bin/claude.exe` and absolute PATH directories for `claude.exe`; command scripts and shell aliases are not run. Keep those locations trusted.
2. Select Anthropic subscription mode and Connect. The app runs official `claude auth login` with a private app configuration/home and an empty working directory. Complete the official browser flow and select your own Claude subscription. The official tool retains its authentication methods, including Console/API; choosing Console does not authorize subscription requests in this app.
3. Check connection status. Only explicit Claude account authentication with a recognized subscription plan is accepted for this mode. Choose a model your plan supports, then send deliberately. Subscription limits and provider terms apply. There is no fallback to an API key if subscription access fails.
4. Disconnect signs out this app-private official CLI profile. Reset aborts pending operations and removes its private credential directories. Your general terminal Claude Code login is separate. Do not copy credential files, paste OAuth tokens or share the private directories.

The app requests CLI safe mode, no built-in tools, empty strict MCP configuration, disabled slash commands/hooks and no session persistence. API/routing environment overrides are stripped. Administrator-managed hooks/settings can still apply under the official tool's policy; managed deployments need explicit review, and no OS sandbox is claimed. An older CLI missing required flags fails rather than silently weakening them. No live login or subscription inference was run during fixture development.

## Grok subscription status

The official Grok CLI supports OAuth, but Grok subscription mode is currently unavailable in this preview's interface. The isolated inference adapter is deferred pending a verified tools/hooks boundary. Use xAI API mode for now. This is roadmap work, not an active background validation process. Do not paste browser cookies or unofficial session tokens.

## Subscription source evidence — 2026-11-08

Directly reviewed [Claude plan/Agent SDK guidance](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan), [CLI reference](https://code.claude.com/docs/en/cli-reference), [settings](https://code.claude.com/docs/en/settings) and [legal/compliance](https://code.claude.com/docs/en/legal-and-compliance). The current support article explicitly says `claude -p` and third-party app usage draw from subscription limits; the legal page separately contains general restrictions on third-party OAuth use and permits unmodified CLI products subject to its terms. The implementation invokes the official user-installed tool and never extracts/replays tokens; these sources are not legal certification or a promise about account eligibility. Recheck provider terms before distributing. [Official Sign in with ChatGPT documentation](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) describes the separate ChatGPT route.
