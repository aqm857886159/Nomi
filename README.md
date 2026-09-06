<p align="center">
  <img src="public/nomi-logo.svg" alt="Nomi" width="80" />
</p>

# Nomi

**Bring the cost of AI video down.**

Nomi is an open-source, local-first desktop workbench for AI video. Use the models, membership credits, APIs, or local ComfyUI you already have to run the whole pipeline — script, storyboard, generation, and editing — with your footage, generated takes, and workflows all on your own machine. No account. No telemetry.

[简体中文](README.zh-CN.md) · [Website](https://nomiaqm.com/en/) · [Download](#download) · [Video tutorial (Bilibili)](https://www.bilibili.com/video/BV1Lf8b6nEjf/) · [Let your AI connect it](docs/integrate-with-your-agent-en.md) · [Community](https://github.com/aqm857886159/Nomi/discussions) · [For Teams](https://nomiaqm.com/en/#teams) · [Watch the 60s film](https://nomiaqm.com/assets/video/launch-film-en.mp4) · [X/Twitter](https://x.com/sdf297417627618)

[![Latest release](https://img.shields.io/github/v/release/aqm857886159/Nomi?label=release)](https://github.com/aqm857886159/Nomi/releases/latest)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-1a1816)
[![License](https://img.shields.io/badge/license-AGPL--3.0--only-1a1816)](LICENSE)

## WeChat / 微信联系

<p align="center">
  <a href="docs/media/nomi-canvas-group-wechat-2026-09-01.jpg"><img src="docs/media/nomi-canvas-group-wechat-2026-09-01.jpg" alt="Nomi user group WeChat QR" width="220" /></a>
  &nbsp;&nbsp;
  <a href="docs/media/qingyang-wechat.jpg"><img src="docs/media/qingyang-wechat.jpg" alt="Nomi maintainer WeChat QR" width="180" /></a>
</p>

<p align="center">
  <strong>Scan to join the Nomi user group</strong> (left) — feedback goes straight into iteration.<br />
  If the group QR expires, or for AGPL-compliant custom development, deployment, and ongoing iteration, add the maintainer (right) at <strong>TZ857886159</strong>.
</p>

[![Nomi director workflow](marketing/assets/video/hero-poster.jpg)](https://nomiaqm.com/assets/video/launch-film-en.mp4)

## Why Nomi

People generating AI video at scale — and companies that want to put AI video to work — increasingly need an **open-source, local** canvas. Three reasons:

**① Cost** — the real spend in AI video is generation. Nomi lets you **freely combine cheap generation sources**: relay wholesale prices, time-limited platform promotions, the free image credits bundled with your agent membership, free sources like ModelScope, and your own local ComfyUI — whichever is cheapest. Layer the "draft → reference → finish" workflow on top: use cheap / free models for storyboard sketches, pose frames, and reference videos (regenerate freely), then feed the good ones as references into a high-quality model, spending the expensive credits only on the final step. Per-unit cost drops sharply.

**② Customization** — the code is open. Use your own Codex / Claude Code to bend it into what you want and add your own skills; a company can customize it into an internal AI-video platform, and the whole team's cost comes down with it.

**③ Local** — your footage, generated takes, workflows, and provider setup all live on your machine. When you call an external model API, only the inputs required to complete the task are sent to the provider you configured.

And a structural difference: **use Nomi as your agent's generation backend.** 25 MCP tools let Codex / Claude Code / Cursor drive Nomi over MCP for generation, orchestration, and editing, reusing the credits bundled with your agent membership. Online platforms make their money on compute, so structurally they can't offer this; an open-source local app is naturally happy to be driven by an agent.

## Connecting your own stack

"Connecting my own stuff is a hassle" is the one big pain point. Nomi gives you two paths:

**① Works out of the box** — **APIMart** and **Kie.ai** are wired in as the two cores, alongside around ten more ready-to-use providers (ModelScope, Volcengine, Runway, fal, Replicate, MiniMax, ElevenLabs, and more); flagship models have a continuously growing integration-certification ledger (currently 66 certified entries). Any OpenAI-compatible, Anthropic, Responses, or relay endpoint can be added by pasting a URL and a key — no rebuild. A local ComfyUI is a provider like any other: Nomi converts the normal "Save" workflow format, so the workflows you download actually import, and it diffs the graph against `/object_info` to tell you which custom nodes and model files you are missing before you run it.

**② Let your AI connect it for you** — you don't have to figure out integration yourself. Clone the repo, hand the **[Let your AI connect Nomi for you](docs/integrate-with-your-agent-en.md)** document to your Codex / Claude Code, and tell it what you want to connect (a relay, DeepSeek, a local ComfyUI…) — it will walk you through it step by step. The doc covers four paths: custom / relay providers, local ComfyUI, MCP driven by an agent, and skill import — each with its "success signal" and a recommended combo that drives cost to the floor.

## Download

| System | Build | Download |
|---|---|---|
| macOS | Apple Silicon | [Nomi-mac-arm64.dmg](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-mac-arm64.dmg) |
| macOS | Intel | [Nomi-mac-intel.dmg](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-mac-intel.dmg) |
| Windows | Windows 10 / 11 x64 | [Nomi-windows-setup.exe](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-windows-setup.exe) |

Supported release targets are macOS arm64/x64 and Windows x64. Linux, Windows arm64, and macOS universal installers are not currently published.

### First launch on macOS

The current macOS build is **not Apple Developer ID signed or notarized**, so macOS may block it on first launch. Only use the direct downloads in the table above or links from the official Nomi website and GitHub repository.

1. Download the matching DMG and drag `Nomi.app` to Applications.
2. In Finder, right-click `Nomi.app` in Applications, choose **Open**, then confirm **Open**.
3. If it is still blocked, open **System Settings → Privacy & Security**, find the Nomi message, and click **Open Anyway**.

Only if macOS says Nomi is “damaged”, first confirm the installer came from an official Nomi link, then run:

```bash
xattr -dr com.apple.quarantine "/Applications/Nomi.app"
```

Do not disable Gatekeeper globally. Updates require downloading the matching DMG and replacing the app manually.

### First launch on Windows

The installer has no Authenticode signature. In the SmartScreen prompt, choose **More info** → **Run anyway**.

## Quick start

1. **Connect a model.** Choose a curated provider and enter one API key, or add your own OpenAI-, Responses-, or Anthropic-compatible endpoint. Connecting your own stuff a hassle? Hand [Let your AI connect Nomi for you](docs/integrate-with-your-agent-en.md) to your Codex / Claude Code and let it do it.
2. **Write the intent.** Start with a story or one shot. Ask Nomi—or a connected AI assistant over MCP—to build an editable storyboard and canvas plan.
3. **Direct and export.** Review visual anchors, generate images or video with your configured models, choose the results, arrange the timeline, and export MP4.

> **Disclosure:** one curated provider (APImart) is linked with a referral code. You always pay providers directly with your own key at their price — Nomi never proxies or resells inference, and every provider can be replaced by your own endpoint.

Read [Let your AI connect Nomi](docs/integrate-with-your-agent-en.md), the [English model connection tutorial](docs/guide/model-connection-en.md), [urgent Codex / Claude Code provider-setup prompt](docs/guide/model-integration-prompt-en.md), [copy-paste Codex issue-fix prompt](docs/guide/codex-issue-fix-prompt-en.md), [user guide](docs/user-guide.md), [provider guide](docs/provider-integration.md), [conversational model integration guide](docs/guide/conversational-model-integration.md), or [CLI + MCP guide](docs/guide/capability-core-cli-mcp.md).

## Feedback & building it together

Nomi is built by one person, and it moves fast — features land quickly, sometimes a little rough around the edges, but it's genuinely moving forward and the commits never stop.

- **Hit a problem? Let your AI fix it first.** The code is open source — send the error along with the [Codex issue-fix prompt](docs/guide/codex-issue-fix-prompt-en.md) to your Codex / Claude Code, and it can patch many issues for you directly.
- **Tell me the general ones and I'll iterate them away.** Say so in the [community](https://github.com/aqm857886159/Nomi/discussions) or open an [Issue](https://github.com/aqm857886159/Nomi/issues); anything everyone runs into, I fold into the mainline.
- Bug reports, feature proposals, docs, and code are all welcome — see [Contributing](#contributing) below.

## Community

Use [GitHub Discussions](https://github.com/aqm857886159/Nomi/discussions) to ask questions, share workflows, and follow what is being built next, and [GitHub Issues](https://github.com/aqm857886159/Nomi/issues) to report bugs and request features. Follow the project on [X / Twitter](https://x.com/sdf297417627618) for release notes and short demos; workflow support is available at **2373272608@qq.com**. There is also a [getting-started walkthrough on YouTube](https://www.youtube.com/watch?v=NugvKQjN22A) (in Chinese). WeChat users can use the group and maintainer QR codes in the [Chinese README](README.zh-CN.md#微信联系).

## For Teams

Nomi is open source for creators. We also provide **Custom builds**, **Integrations**, **AGPL-compliant deployment**, and **Ongoing iteration** for teams that need Nomi adapted to a real delivery workflow.

[Discuss a project](https://github.com/aqm857886159/Nomi/issues/new?template=business_inquiry.yml). The form is public: share only a non-confidential summary and never post credentials, private contact details, budget details, or NDA-protected information.

## Developers

Requires Node.js 20+ and pnpm.

```bash
git clone https://github.com/aqm857886159/Nomi.git
cd Nomi
corepack enable
pnpm install
pnpm dev
```

```text
electron/    Electron main process, local runtime, storage, and model calls
src/         React + Vite + Tailwind workbench
skills/      Skill Pack v2; see docs/skill-pack-format.md
```

Useful checks:

```bash
pnpm run test
pnpm run typecheck
pnpm run gates
```

Research tooling: `scripts/research/tikhub-search.mjs` searches Chinese social platforms (Douyin / Xiaohongshu / Bilibili / X) for what creators are actually saying about a topic. It reads its credential **only** from the `TIKHUB_API_KEY` environment variable — set it in your shell profile (`export TIKHUB_API_KEY="..."`, obtained from <https://www.tikhub.io>), never in a repo file or on the command line; without it the script says so and exits non-zero rather than returning empty results. See [`docs/research/tikhub-api-notes.md`](docs/research/tikhub-api-notes.md).

## Contributing

Bug reports, feature proposals, documentation, and code contributions are welcome. Contributors do not need to sign a CLA; contributions are accepted under AGPL-3.0-only.

- [Report a bug](https://github.com/aqm857886159/Nomi/issues/new?template=bug_report.yml)
- [Request a feature](https://github.com/aqm857886159/Nomi/issues/new?template=feature_request.yml)
- [Ask a question or share an idea](https://github.com/aqm857886159/Nomi/discussions)

## License

Current releases are licensed under AGPL-3.0-only; historical releases published under Apache-2.0 keep their original license.

See [LICENSE](LICENSE). Paid services can include AGPL-compliant custom development, integration, deployment, training, and ongoing iteration. Nomi does not offer a closed-source distribution that withholds the corresponding source code.
