# Provider Integration

Nomi is designed to connect to the model providers you choose. A provider can be an image generation API, video generation API, private gateway, or internal service.

## Integration Flow

1. Collect the provider documentation URL or API reference.
2. Create a provider entry in the model catalog.
3. Configure authentication with your own key.
4. Map request fields such as prompt, images, aspect ratio, duration, and model name.
5. Map task creation, polling, and result extraction.
6. Run a small test generation and inspect the returned asset URL.

## Agent-Assisted Setup

You can ask Nomi Agent to read a provider document and draft the integration plan. The agent should help explain request formats and result parsing, but final configuration and key usage remain under your control.

## Security

- Keep keys in local env files or local agent config.
- Do not commit `apps/agents-cli/agents.config.json`.
- Do not commit `.env` files.
- Prefer explicit errors over silent fallbacks when a provider fails.
