# Let your AI connect Nomi for you (hand this doc to your agent)

> **You are the user's agent (Codex / Claude Code / Cursor / a local CLI, etc.). The user handed you this document because they want you to connect a model, a local ComfyUI, or a skill into the Nomi running on their machine.**
> **Walk the user through it step by step**: first find out what they want to connect, then follow the matching section, and at every step tell them what they should be seeing and what to click next. Finish each path with its "success signal" so you both know it actually works.
>
> Nomi is an open-source local desktop workbench — the code is on the user's machine. Wherever this doc doesn't cover something, or the user's UI doesn't match what's written here, **read the source, don't guess.** Repo landmarks are at the end.

Clone the repo (only needed if the user wants to change code; connecting models works from the packaged app):

```bash
git clone https://github.com/aqm857886159/Nomi.git
```

---

## 0. First ask: which of the four is the user connecting?

Four paths, one per "connect my own thing" scenario. Decide, then jump to the section:

| What the user wants to connect | Path | In one line |
|---|---|---|
| An OpenAI-compatible / Anthropic / relay API (DeepSeek, self-hosted vLLM, some relay…) | **§1** | Paste a URL + key, no rebuild |
| Their local ComfyUI (or a cloud ComfyUI) | **§2** | Keyless backend, import "Save"-format workflows |
| Letting you (the agent) drive Nomi over MCP for generation / orchestration | **§3** | One-click connect, then just talk to it |
| A skill that extends Nomi's Agent | **§4** | Drop it into `skills/`, it gets discovered |

> **Cost lens (throughout)**: Nomi's whole point is letting you **freely combine cheap generation sources** — relay wholesale prices, time-limited platform promotions, the free image credits bundled with your agent membership, free sources like ModelScope, and your local ComfyUI — whichever is cheapest at the moment. Layer the "draft → reference → finish" workflow (see §5) on top and per-unit cost drops hard. Connecting is where you wire all those cheap sources in.

---

## 1. Connect a custom / relay provider (OpenAI-compatible / Anthropic / Responses)

**For**: anything that exposes a standard interface — DeepSeek, Qwen, a self-hosted vLLM, any "API relay". Source of truth: `src/ui/onboarding/CustomVendorCard.tsx` and `src/ui/onboarding/VendorBaseUrlField.tsx`.

**Walk the user through it:**

1. Open Nomi → go to **Model Connection** (the onboarding drawer in settings).
2. Find the **"Other models / Custom provider"** entry and add one. Each provider renders as a `CustomVendorCard`.
3. This card's subject is the **connection** — the top row is the **base URL** (`VendorBaseUrlField`). Click **"Edit"** on the right to fill it in:
   - It must be a full `http(s)://…` base URL (validated as `^https?://\S+$`; a trailing `/` is stripped). For OpenAI-compatible endpoints this is usually up to `.../v1`.
   - Press Enter or click Save. After saving, Nomi **re-probes the connection automatically** (changing the URL changes the health fingerprint, which re-triggers the probe) — no manual re-check needed.
4. In the same card's **Models** section, add / enable the models you want. If Nomi guessed the type (image / video / text) wrong from the model name, fix it here (`onRetype`).
5. If the provider needs a key, enter the API Key on the card (keys are encrypted under the app identity, stored locally, never logged).

> **Card pill semantics**: **unreachable overrides everything.** Even if parameter adaptation shows "configured", a bad URL / key paints the card header red and tells you "unreachable". So don't just watch for "configured" — watch the connection go green.

**✅ Success signal:**
- The card's connection pill shows **Connected / OK** (not the red "unreachable").
- The models you enabled appear in the available list. `node scripts/nomi.mjs models` also lists them (vendor / modelKey / kind / label).

---

## 2. Connect a local ComfyUI (as a generation backend)

**For**: the user runs ComfyUI locally (or in the cloud) and wants it as a cheap / free generation backend. Source of truth: `src/ui/onboarding/ComfyuiLocalCard.tsx` and `electron/catalog/comfyuiLocal.ts`.

**Key premise (tell the user first)**: ComfyUI is a **keyless** local service. This provider is **disabled by default** in Nomi — because 99% of users don't run a local ComfyUI, and shipping it on would just add a pile of failing workflows. So the user must **enable it explicitly under "Connectable"**.

**Walk the user through it:**

1. Confirm ComfyUI is running. The default address is **`http://127.0.0.1:8188`**; if it's on another port / host (or a cloud ComfyUI like cnb.cool, cloudstudio.net), change the card's **address** row to that URL — same card, same address row, the cloud case just swaps the URL, no separate card.
2. Open Nomi → Model Connection → find the **"Local ComfyUI"** card (`ComfyuiLocalCard`).
3. **Import a workflow**: click "Import workflow" and paste the workflow JSON.
   - It accepts ComfyUI's normal **"Save" format** as well as the API format — workflows you download off the web import directly, no manual API export first.
   - Nomi ships a built-in **text-to-image** workflow (ComfyUI's official default graph), so there's a working path even without importing.
4. Click **"Enable"**. Note: enabling probes the connection first, but the provider and its models only enter the runnable catalog after one **canonical production certification** pass (this prevents "saved, so I assume it runs"). So after enabling you may see "awaiting verification" — it counts once certification completes.

> **Nomi vets it before you hit run:**
> - If the checkpoint name is left empty, Nomi fetches your machine's first checkpoint from ComfyUI's `/object_info` and fills it in (the old approach hardcoded a filename, so anyone without that file failed on the first run).
> - If it can't connect, or `models/checkpoints` has no model file at all, Nomi raises a **deterministic error up front** ("not connected to ComfyUI…" / "no model files in the directory…") instead of polling to a timeout.
> - That is what "diff the graph against `/object_info` and tell you what's missing" means in practice.

**✅ Success signal:**
- The card status flips from "Not enabled" to **"Running"** and shows the ComfyUI version.
- A text-to-image run produces an image (which lands in the project `assets/` directory).

---

## 3. Let the agent drive Nomi over MCP (Nomi as your generation backend)

**For**: letting you (Codex / Claude Code / Cursor) operate the user's Nomi directly — create projects, lay out shots, wire references, really generate images / video / text, run a durable production run. This is Nomi's structural difference from online platforms: **an open-source local app is naturally happy to be driven by an agent, and the credits bundled with your agent membership carry straight over**; online platforms make their money on compute, so structurally they can't do this.

Full reference: `docs/guide/capability-core-cli-mcp.md`. **Walk the user through it:**

1. Open Nomi → Model Connection → **"Connect an AI coding assistant"**, pick Claude Code / Codex / Cursor, and connect.
   - Nomi merges only its own `nomi` entry, keeps your existing MCP servers, and leaves a `.nomi-backup` before rewriting.
   - The connect card **actually launches the configured command and does a handshake** — it doesn't show success just because "there's a line in the config".
   - **Do not** hand-write a config that only has `NOMI_MCP_STDIO=1`: the current version issues a machine-signed `NOMI_MCP_CLIENT` / `NOMI_MCP_CLIENT_PROOF` per client, bound to this machine and this client — not reusable across clients, not something to hardcode in a public doc. A config missing the proof can list tools, but a real paid Production Run is safely treated as `external`.
2. **Restart the client** as prompted so it reloads the MCP config.

**✅ Success signal:**
- After the handshake, your client shows a set of `nomi` tools (semantic read/write for canvas, documents, timeline and media, plus the zero-credit `nomi_operation_*` editable-generation flow). **Treat `tools/list` as the source of truth for the count and the names** — a number copied into prose goes stale the moment the surface changes, and this doc has been wrong about it before.
- You can run end to end: "create a project 'coffee ad' in Nomi → list my image models → add 3 shots → generate the first one".

> **Boundaries (state them honestly, to the user too)**: MCP can create / observe / control a run; **direction and sample** (reversible creative gates) can be re-confirmed by the Nomi server to elicitation-capable clients. But **budget, per-shot paid submission, rough-cut acceptance, and export** must return to Nomi for the user's explicit approval, enforced in the main process — you the agent cannot spend money out of band.

---

## 4. Import a skill

**For**: adding a piece of methodology / capability to Nomi's Agent (a storyboarding approach, an editing pattern, etc.). Format spec: `docs/skill-pack-format.md`.

A skill is a directory under `skills/<skill-key>/` with **exactly one required file**:

- **`SKILL.md`**: opens with YAML frontmatter (the runtime manifest: required `name` — lowercase kebab, matching the directory name — and `description`; Nomi's own tool allowlist / modality declarations / playbook stages go under `metadata.nomi`), followed by the methodology body for the LLM (keep it ≤200 lines).

That is the [Agent Skills standard](https://agentskills.io/specification) shape, which pi, Claude Code and Codex all read — so **someone else's skill directory works here, and ours works there**.

**Walk the user through it:**

1. Get the skill (usually distributed as a zip or a git directory).
2. Copy the whole `<skill-key>/` directory **into the repo's `skills/`** (unzip first if needed).
3. Start / restart Nomi (in dev, `pnpm dev`). The skill is **auto-discovered** in the AI panel.

> A pure knowledge skill with only `name` + `description` and no `metadata.nomi` loads fine — most of the ecosystem looks like that.
> A malformed `metadata.nomi` **fails closed** (that skill gets zero tools) and surfaces a plain-language reason in the panel; the main-process log also prints the Zod validation error.
> The second manifest file `skill.json` was retired on 2026-09-07; anything left in the user directory is migrated into the frontmatter on load, with the original kept as a `.bak`.

**✅ Success signal:**
- The skill shows up / is selectable in Nomi's AI panel.
- No Zod validation error in the main-process log on load.

---

## 5. Recommended combos (drive cost to the floor)

Give the user a default "cheap drafts → high-quality finish" workflow, and wire all of these in during setup:

**The cheap / free generation trio (connect via §1 / §2):**
- **The image credits bundled with your agent membership** (e.g. the image / video credits in your Codex / local-CLI account) — often free or already included, so drafting concept and pose frames costs nothing.
- **Free / low-cost sources** (e.g. ModelScope's open models) — for simple storyboard frames and batch tries.
- **Local ComfyUI** (§2) — zero API cost, maximum control.
- Plus one **relay at wholesale price** (via §1) to cover the one high-quality generation, and switch to a **time-limited promotion** on some platform when one is running.

**The workflow — draft → reference → finish:**
1. Use cheap / free models for storyboard sketches, pose frames, reference videos (regenerate freely, spit out several at once).
2. Feed the good ones as **reference images / reference videos** into a high-quality model, spending the expensive credits only on the final step.
3. The cost structure drops sharply, and you can keep adjusting along the way.

**Wire a cheap brain for the agent too:**
- Give Nomi's Agent a cheap OpenAI-compatible text model (e.g. DeepSeek), connected via §1 — it handles the text work: writing prompts, breaking down shots, planning.

---

## Landmarks for the agent (read the code if you can't find it — don't guess)

- Custom / relay provider card: `src/ui/onboarding/CustomVendorCard.tsx`; address field `src/ui/onboarding/VendorBaseUrlField.tsx`; manage block `src/ui/onboarding/CustomVendorManage.tsx`.
- Local ComfyUI card: `src/ui/onboarding/ComfyuiLocalCard.tsx`; backend contract / defaults / `/object_info` reconciliation: `electron/catalog/comfyuiLocal.ts`.
- Built-in provider list (which hosts Nomi recognizes): `electron/catalog/builtinVendorSeeds.ts`.
- Full MCP / CLI flow, 33 tools, troubleshooting, security boundaries: `docs/guide/capability-core-cli-mcp.md`.
- Skill format: `docs/skill-pack-format.md`.
- General provider integration: `docs/provider-integration.md`; user guide: `docs/user-guide.md`.

The UI evolves — **wherever a step doesn't match what you see, the source on the user's machine wins.**
