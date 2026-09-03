# Urgent provider setup prompt for Codex or Claude Code

Use this prompt when you need to connect a provider immediately. It first uses Nomi's MCP server and the built-in `model-integration` Skill. If the installed build is missing a provider-private upload capability, it gives the agent a narrowly scoped local implementation task for that upload channel—without adding a full Runway model adapter or opening a pull request.

First connect Nomi to Codex or Claude Code from **Model setup → Connect AI coding assistant**. Then paste the prompt below.

```text
===== PROMPT START =====

You are helping me connect an AI provider to my local Nomi installation. I need a working provider setup, not a contribution to the upstream project.

## Hard boundaries

- Do not open a pull request, push to any remote, or ask me to submit one.
- If source changes are necessary, work only in my local checkout, preserve existing changes, and use a local task branch. Do not commit unrelated work.
- Never ask me to paste an API key into chat, a tool argument, a URL, a log, or a file. Open Nomi's secure credential UI and ask me to enter the key there.
- Never echo credentials, Authorization headers, signed URLs, private paths, phone numbers, or confidential reference images.
- Do not guess an endpoint, model ID, authentication method, request field, response field, upload route, or capability from a provider name.
- Do not add a full Runway model/Seedance 2.5 adapter in this task. The urgent scope is provider onboarding and, if needed, a provider-private Runway upload channel for reference assets.

## Start with the existing Nomi Skill and MCP

1. Confirm that the Nomi MCP server is connected and that these tools are available: `nomi_integration`, `nomi_integration_manage`, and `nomi_read`.
2. If the tools are missing, tell me to open Nomi's **Model setup → Connect AI coding assistant** card, complete its generated configuration, and restart this client. Do not hand-edit an MCP config as a workaround.
3. Read the `model-integration` Skill if this MCP host exposes `nomi-skill://model-integration`. If a repository checkout is open, also read `skills/model-integration/SKILL.md`, `docs/provider-integration.md`, `docs/guide/model-connection-en.md`, and `docs/guide/capability-core-cli-mcp.md`. Treat the Skill and tool schemas as the source of truth.

## Gather public evidence, not secrets

Ask me in one short message for:

- provider name;
- the provider's official API documentation URL or public request example;
- the exact model IDs and modes I need (text, image, video, or audio);
- whether this is a native local ComfyUI server or an ordinary HTTP provider;
- if reference images are needed, whether the provider documents its own upload endpoint.

Do not ask for the API key. Do not ask for my phone number or private contact details. Use the official provider documentation (not a marketing page) to verify every request and upload field.

## Connect and certify the provider

1. Call `nomi_integration` with `action: "begin"` and the public connection material. Preserve the documentation URL and the provider's exact terminology as evidence.
2. Call `nomi_integration` with `action: "open_credentials"` so I can enter the key in Nomi's secure UI. Wait for me to finish; never handle the key yourself.
3. Read the official docs and use web/Bash to discover every candidate page, translate relay quirks, and keep exact model IDs and modes. Do not ask Nomi to perform discovery or pagination.
4. Show me a concise list of candidates that match my requested modes, then call `nomi_integration` once with `action: "propose"`, complete HTTP `candidates` + `selections`, or a final ComfyUI `workflow`. If it returns a readable `propose rejected` reason, fix that field and retry with the returned revision.
5. For native ComfyUI, put the final workflow in the `propose` payload and bind inputs by `nodeId`, `inputKey`, `paramKey`, and `mediaKind` when applicable. Never map `widgets_values` by array position. A cloud service that does not implement native ComfyUI routes is an ordinary HTTP provider.
6. Before any paid or external generation, call `nomi_integration` with `action: "confirm"`. I must confirm the exact provider, model(s), modes, and expected cost in Nomi's trusted UI; you cannot invent or bypass the receipt.
7. After I confirm in Nomi, call `nomi_integration` with `action: "start"` and the opaque receipt handle returned by Nomi.
8. Poll `nomi_read` with `target: "integration"` and report the real final state. Treat credential storage, accepted proposal, or a staged draft as incomplete. Say “verified and available” only after the certification run completes, the bounded artifact is decoded, the journal is committed, and a fresh-process readback succeeds.

## If the provider's private upload channel is missing

Use this fallback only when the official documentation proves that the provider accepts a local reference through its own upload endpoint and the current Nomi build cannot use it:

1. If a source checkout is not open, clone `https://github.com/aqm857886159/Nomi.git` into a local directory. Read `AGENTS.md` before editing, inspect the current branch and worktree, and create a local task branch. Do not push or open a pull request.
2. Trace the existing shared path from asset localization to provider request construction. Reuse the existing generic `AssetIngestion` contract and upload helpers; do not create a second upload pipeline or a provider-specific UI.
3. Add only the provider-private Runway upload declaration/adapter required by the verified official contract. Choose `upload-multipart`, `upload-url`, or `upload-stream` only when the documentation proves that strategy, exact endpoint, auth, file field, extra fields, response URL path, accepted media kinds, and URL lifetime.
4. Make the target provider's private channel win before KIE, APIMart, or the anonymous chain for that provider's requests. Keep KIE as an existing fallback where the shared resolver requires it, but never silently send a confidential reference to an anonymous host.
5. Add focused tests that prove: the exact endpoint and auth are used; the response URL is extracted and validated; the target Runway channel is preferred; anonymous upload is not selected when the private channel is available; transient upload failures remain bounded; and credentials never appear in logs or results.
6. Do not add Runway model IDs, Seedance 2.5 catalog entries, or a new model UI in this urgent upload-only change. If the official upload contract is unavailable or cannot be verified, stop and report the missing evidence instead of guessing.
7. Run the narrow tests and relevant repository gates locally. Report changed files, test results, and any unverified live-provider step. Leave the changes in my local checkout; do not create a PR.

## Reference images and anonymous uploads

- Start with one reference and the smallest possible test.
- Follow the provider's documented choice of provider upload, public URL, base64 data URL, or reference field.
- If an anonymous upload host fails, treat it as a transport/network/provider-upload problem. Do not expose confidential references and do not silently retry a different anonymous host. Prefer the verified provider-private upload channel; use a configured alternative or direct multipart bytes only when Nomi's shared workflow supports it.

## Failure reporting

- If the result is `partial`, list each unavailable model or mode and exactly one next action.
- If authentication, balance, quota, or security fails, do not blindly retry.
- If a submission result is unknown, reconcile it with the remote task ID before doing anything else.
- At the end, summarize the connected provider, verified model/mode list, upload route and privacy level, test result, and remaining limitations. Never include secrets or private data.

===== PROMPT END =====
```

If the integration is blocked, send only the redacted error and the provider's public request example to the Nomi maintainer through the support contacts in the [English model connection tutorial](model-connection-en.md). Do not publish keys, phone numbers, private URLs, or confidential assets.
