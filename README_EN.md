<p align="center">
  <img src="apps/web/public/nomi-logo.svg" alt="Nomi" width="96" />
</p>

<h1 align="center">Nomi</h1>

<p align="center">
  <strong>A local-first open-source AI video workspace where scripts, image generation, video generation, and editing flow together.</strong>
</p>

<p align="center">
  <a href="README.md">中文</a>
  ·
  <a href="README_EN.md"><strong>English</strong></a>
  ·
  <a href="docs/quickstart.md">Quickstart</a>
  ·
  <a href="docs/provider-integration.md">Provider integration</a>
</p>

<p align="center">
  <a href="https://github.com/aqm857886159/Nomi/stargazers"><img src="https://img.shields.io/github/stars/aqm857886159/Nomi?style=for-the-badge&logo=github" alt="GitHub stars" /></a>
  <a href="https://github.com/aqm857886159/Nomi/releases/latest"><img src="https://img.shields.io/github/v/release/aqm857886159/Nomi?style=for-the-badge&logo=electron&logoColor=white&label=Desktop+Download" alt="Desktop Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=for-the-badge" alt="License" /></a>
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
</p>

---

## What Is Nomi

Nomi is a local-first open-source workspace for AI video creation. It connects script writing, image generation, video generation, and timeline editing in one production flow instead of forcing creators to copy assets between disconnected tools.

Write a script, turn prompts into image and video nodes, drag generated clips into the timeline, and reuse edited fragments as new creative references. The core idea is smooth data flow between text, images, videos, nodes, and editing.

## Core Advantages

### Scripts, images, videos, and editing are one flow

- Script prompts can create image and video nodes.
- Image nodes can become first frames, last frames, or visual references for video.
- Generated images and videos can be dragged into the timeline.
- Timeline clips can flow back into the canvas as new references.

### Local-first and open source

Nomi is designed as a local open-source project. Your scripts, assets, generated outputs, project files, and editing process can stay on your own computer. You decide which providers need network access and which materials stay local.

### Bring your own providers

Nomi should not lock you into one model platform. You can connect image generation providers, video generation providers, private model gateways, or internal APIs.

### Agent assists, creators decide

Nomi Agent can help break down scripts, create node plans, write prompts, and plan production steps. It gives suggestions; the final creative choices remain yours.

---

## Quickstart

### Desktop App (Recommended)

Download the installer from [GitHub Releases](https://github.com/aqm857886159/Nomi/releases/latest):

- **macOS**: Download `.dmg`, drag to Applications, open it
- **Windows**: Download `.exe`, install and launch from Start Menu

No Docker, no terminal, no setup required.

### Developer Mode (Source)

Requirements: Node.js 20+, Docker Desktop.

```bash
git clone https://github.com/aqm857886159/Nomi.git
cd Nomi
corepack enable && pnpm install && pnpm start:local
```

Open **http://localhost:5173**.

More details: [docs/quickstart.md](docs/quickstart.md).

---

## Configuration

### AI Chat (Workspace / Terminal Agent)

Edit `apps/agents-cli/agents.config.json`:

```json
{
  "apiBaseUrl": "https://api.openai.com/v1",
  "apiKey": "your-key",
  "model": "gpt-4o"
}
```

Any OpenAI-compatible API works: DeepSeek, Qwen, Ollama, etc.

### Image / Video Generation Models

In the Web UI: **top-right → Model Management → Add Provider → Add Model**.

Supports Kling, Dreamina, Runway, and custom model gateways. See [docs/provider-integration.md](docs/provider-integration.md).

---

## Project Structure

```
apps/desktop      Desktop app (Electron, no Docker needed)
apps/web          Web workspace (React + Vite)
apps/hono-api     Local API (Hono + Prisma)
apps/agents-cli   Terminal Agent bridge
packages/schemas  Shared schemas and protocols
docs              Documentation
```

---

## Keywords

AI video editor, local AI video tool, open source AI video generator, AI storyboard workflow, script to image, script to video, image to video, AI canvas, local-first creative tool, AI agents, video generation workflow.

## License

Apache-2.0
