---
name: model-integration
description: Connect HTTP models or a native ComfyUI workflow through Nomi's verified certification path.
---

# Nomi model integration

Use Nomi's integration tools to turn a vendor endpoint or a native ComfyUI workflow into a capability that remains usable after restart. The tools are the contract; do not edit Nomi source, Catalog files, or MCP configuration by hand.

## Order

1. Start with `nomi_integration_begin` using public connection material only. Include the official documentation URL, pasted contract text, or a workflow reference when available.
2. If credentials are needed, call `nomi_integration_open_credentials`. Never ask for, receive, echo, or place an API key in a tool argument, chat message, log, URL, or file.
3. Call `nomi_integration_discover` repeatedly until the complete candidate set is covered. Use page and search fields. Preserve each candidate's exact model id, declared capability modes, evidence source, and classification state.
4. Select exact candidates with `nomi_integration_select`. Select several at once when requested. If the tool returns `unresolvedFields`, ask every listed question in one message and submit all answers with `nomi_integration_resolve_input`.
5. For ComfyUI, use `nomi_integration_submit_workflow`. API workflows and ordinary UI-saved workflows are both valid. Bind inputs by `nodeId`, `inputKey`, `paramKey`, and `mediaKind`; never zip `widgets_values` by position. Keep numeric inputs such as `frame_rate` numeric and each media slot distinct.
6. Before any cost, call `nomi_integration_request_confirmation` to create the immutable contract and open Nomi's trusted confirmation UI. The user must confirm there; an agent cannot invent a receipt or confirm spend on the user's behalf. Then call `nomi_integration_start` with Nomi's opaque receipt handle.
7. Poll `nomi_integration_get` and report the real result. A secure key, successful discovery, staged draft, or partial batch is not completion. Only verified modes promoted after a real production request, bounded artifact decode, journal commit, and fresh-process readback are usable.

## Evidence and failures

- Prefer official vendor documentation and evidence returned by Nomi. Do not guess endpoint paths, auth names, parameter types, or capability kinds.
- Treat `partial` as partial. Report each unavailable model or mode with its stable reason and exactly one next action.
- Do not silently truncate candidates. Continue pagination or tell the user why a page cannot be fetched.
- Do not blindly retry auth, balance, quota, security, or unknown-submission failures. An unknown submission may only be reconciled by its remote task id.
- A contract mismatch may be repaired only within Nomi's bounded attempt limit. If repair fails, preserve the previous active revision and start a new draft.

## ComfyUI boundary

This skill covers the native ComfyUI Server routes (`/features`, `/models`, `/workflow_templates`, `/object_info`, `/upload/image`, `/prompt`, `/history`, `/view`, and `/ws`). A platform Cloud or Serverless API that does not implement those routes is an ordinary HTTP provider, not native ComfyUI.

## Safe wording

Say “securely saved, not yet verified” after credential storage. Say “configured, awaiting certification” for a draft. Say “verified and available” only after the final run state says so. Never include credentials, Authorization values, signed URLs, absolute paths, connection fingerprints, or raw provider error pages in a response.
