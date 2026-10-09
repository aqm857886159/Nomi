<p align="center">
  <a href="https://nomiaqm.com/en/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="marketing/assets/promo-0.22/cover-en-dark.jpg" />
      <img src="marketing/assets/promo-0.22/cover-en-light.jpg" alt="Nomi — Pro-grade AI video. Models at their real price." width="100%" />
    </picture>
  </a>
</p>

<p align="center">
  <strong>Nomi is an open-source, local-first AI video studio.</strong><br />
  Tell its agent what you want to make. It plans the shots, generates keyframes and video, and lays them on your timeline —<br />
  with the models <em>you</em> connect, at the price <em>your provider</em> charges.
</p>

<p align="center">
  <a href="#download"><b>Download</b></a> ·
  <a href="https://nomiaqm.com/en/">Website</a> ·
  <a href="#watch-the-film">Watch the 90-second film</a> ·
  <a href="https://nomiaqm.com/en/quickstart">Quick start</a> ·
  <a href="docs/integrate-with-your-agent-en.md">Let your AI connect it</a> ·
  <a href="#community">Community</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/aqm857886159/Nomi/releases/latest"><img src="https://img.shields.io/github/v/release/aqm857886159/Nomi?label=release&color=1a1816" alt="Latest release" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-1a1816" alt="Platform" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--only-1a1816" alt="License" /></a>
</p>

## Why Nomi

Relays, official APIs, ComfyUI, and local models are cheap. Commercial AI video products often run the very same models and charge several times more.

Nomi gives you a pro-grade workflow on top of **your own** models. You pay your provider directly, at their price. Even the agent runs on the model you pick — no subscription, no markup.

## Watch the film

[![Watch the 90-second Nomi 0.22 film](marketing/assets/promo-0.22/film-poster-en.jpg)](https://github.com/aqm857886159/Nomi/blob/main/marketing/assets/video/nomi-0.22-film.mp4)

Every screen in the film is Nomi's real UI, and every image and clip in it was generated with Nomi.

## What you can do

### Just ask — the agent works on your canvas

<img src="marketing/assets/promo-0.22/still-agent.jpg" alt="The Nomi agent turning one request into four keyframes on the canvas" width="100%" />

Describe the film you want. The agent reads your canvas, splits the story into shots, generates keyframes, turns them into video, and arranges the timeline. Everything it makes lands on the canvas, where you can see it and change it.

You decide how much it asks: **Ask each step**, **Auto-edit** (paid generation still asks), or **Full auto**.

### Direct every shot

<img src="marketing/assets/promo-0.22/still-storyboard.jpg" alt="Storyboard with all four shots generated and the character reference card locked" width="100%" />

The storyboard puts each shot on one row — prompt, first frame, model, duration. Lock a reference card for a character or a place, and every shot that uses it keeps the same face.

### A 3D director you can hold in your hand

<img src="marketing/assets/promo-0.22/still-director.jpg" alt="The 3D director with the phone viewfinder page" width="100%" />

Pose characters, place cameras, and use your phone as the viewfinder. The frames you capture go straight back onto the canvas.

### Any model, per shot

<img src="marketing/assets/promo-0.22/still-model.jpg" alt="The same video card generated again with a different model" width="100%" />

Seedance, Kling, Wan, Hailuo, Nano Banana, GPT Image and more — through APIMart, Kie.ai, Volcengine, ModelScope, a Dreamina membership, any OpenAI-compatible relay, or your local ComfyUI. Swap the model on a single shot and generate another take.

### New model today, in Nomi today

When a new model ships, click **Let AI connect it for me** and let Claude Code or Codex wire it in. It looks up the endpoint, parameters and model IDs, has you paste your key on Nomi's own page (the assistant never sees it), runs one real test, and lists the model once it works.

### Yours

A project is a plain folder on your disk: canvas, storyboard, timeline, every generated file, and the exported film. No account, no telemetry. The code is AGPL-3.0.

**Next up: AI editing.** Nomi is heading toward one studio for everything you make with AI — come build it with us.

## Download

| System | Build | Download |
|---|---|---|
| macOS | Apple Silicon | [Nomi-mac-arm64.dmg](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-mac-arm64.dmg) |
| macOS | Intel | [Nomi-mac-intel.dmg](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-mac-intel.dmg) |
| Windows | Windows 10 / 11 x64 | [Nomi-windows-setup.exe](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-windows-setup.exe) |

Supported release targets are macOS arm64/x64 and Windows x64. Linux, Windows arm64, and macOS universal installers are not currently published.

<details>
<summary><b>First launch on macOS</b></summary>

The current macOS build is **not Apple Developer ID signed or notarized**, so macOS may block it on first launch. Only use the direct downloads above or links from the official Nomi website and GitHub repository.

1. Download the matching DMG and drag `Nomi.app` to Applications.
2. In Finder, right-click `Nomi.app` in Applications, choose **Open**, then confirm **Open**.
3. If it is still blocked, open **System Settings → Privacy & Security**, find the Nomi message, and click **Open Anyway**.

Only if macOS says Nomi is “damaged”, first confirm the installer came from an official Nomi link, then run:

```bash
xattr -dr com.apple.quarantine "/Applications/Nomi.app"
```

Do not disable Gatekeeper globally. Updates require downloading the matching DMG and replacing the app manually.
</details>

<details>
<summary><b>First launch on Windows</b></summary>

The installer has no Authenticode signature. In the SmartScreen prompt, choose **More info** → **Run anyway**.
</details>

## Quick start

1. **Connect a model.** Pick APIMart or Kie.ai and paste one key — or add your own relay, OpenAI-compatible endpoint, or local ComfyUI. Rather not do it yourself? Hand [Let your AI connect Nomi](docs/integrate-with-your-agent-en.md) to Claude Code or Codex.
2. **Say what you want to make.** Type it into the agent panel, or start from a story in the storyboard.
3. **Direct and export.** Keep the takes you like, arrange the timeline, export MP4.

> **Disclosure:** the APIMart link carries a referral code. You always pay providers directly with your own key at their price. Nomi never proxies or resells inference, and every provider can be swapped for your own endpoint.

More: [quick start](https://nomiaqm.com/en/quickstart) · [model connection](docs/guide/model-connection-en.md) · [user guide](docs/user-guide.md) · [providers](docs/provider-integration.md) · [CLI + MCP](docs/guide/capability-core-cli-mcp.md)

## Use Nomi from your own agent

Nomi ships an MCP server with 24 MCP tools, so Claude Code, Codex, or Cursor can drive it — generate, arrange, and edit — while reusing the credits that come with your agent subscription. See [Let your AI connect Nomi](docs/integrate-with-your-agent-en.md).

## Community

- Questions, workflows, what's next: [GitHub Discussions](https://github.com/aqm857886159/Nomi/discussions)
- Bugs and feature requests: [GitHub Issues](https://github.com/aqm857886159/Nomi/issues)
- Release notes and short demos: [X / Twitter](https://x.com/sdf297417627618) · [Bilibili](https://www.bilibili.com/video/BV1Lf8b6nEjf/)

WeChat users can scan to join the user group (left). If the group code has expired, add the maintainer (right) at **TZ857886159**.

<p align="center">
  <a href="docs/media/nomi-canvas-group-wechat-2026-10-17.jpg"><img src="docs/media/nomi-canvas-group-wechat-2026-10-17.jpg" alt="Nomi user group WeChat QR" width="220" /></a>
  &nbsp;&nbsp;
  <a href="docs/media/qingyang-wechat.jpg"><img src="docs/media/qingyang-wechat.jpg" alt="Nomi maintainer WeChat QR" width="180" /></a>
</p>

Hit a bug? The code is open — send the error and the [issue-fix prompt](docs/guide/codex-issue-fix-prompt-en.md) to Claude Code or Codex, and it can often patch it for you. Anything everyone runs into, tell us and it goes into the mainline.

## For Teams

**Custom builds**, **Integrations**, **AGPL-compliant deployment**, and **Ongoing iteration** for teams that want Nomi inside a real production workflow. [Discuss a project](https://github.com/aqm857886159/Nomi/issues/new?template=business_inquiry.yml) — the form is public, so share only a non-confidential summary and never post credentials, private contact details, budget details, or NDA-protected information.

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

Useful checks: `pnpm run test` · `pnpm run typecheck` · `pnpm run gates`

Research tooling (searching what creators say on Douyin / Xiaohongshu / Bilibili / X) reads its key only from the `TIKHUB_API_KEY` environment variable — see [`docs/research/tikhub-api-notes.md`](docs/research/tikhub-api-notes.md).

## Contributing

Bug reports, feature proposals, documentation, and code contributions are welcome. Contributors do not need to sign a CLA; contributions are accepted under AGPL-3.0-only.

- [Report a bug](https://github.com/aqm857886159/Nomi/issues/new?template=bug_report.yml)
- [Request a feature](https://github.com/aqm857886159/Nomi/issues/new?template=feature_request.yml)
- [Ask a question or share an idea](https://github.com/aqm857886159/Nomi/discussions)

## License

Current releases are licensed under AGPL-3.0-only; historical releases published under Apache-2.0 keep their original license.

See [LICENSE](LICENSE). Paid services can include AGPL-compliant custom development, integration, deployment, training, and ongoing iteration. Nomi does not offer a closed-source distribution that withholds the corresponding source code.
