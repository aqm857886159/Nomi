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

## What Is Nomi

<p align="center">
  <img src="apps/web/public/nomi-mascot.png" alt="Nomi mascot" width="280" />
</p>

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

Nomi should not lock you into one model platform. You can connect image generation providers, video generation providers, private model gateways, or internal APIs. Give Nomi Agent a provider document link or website, and it can help understand the API, plan the integration, map request parameters, and parse results.

### Agent assists, creators decide

Nomi Agent can help break down scripts, create node plans, write prompts, plan production steps, and debug generation issues. It gives suggestions; the final creative choices remain yours.

## Quickstart

Requirements:

- Node.js 20+
- pnpm 10+
- PostgreSQL 16+

```bash
git clone https://github.com/aqm857886159/Nomi.git
cd Nomi
pnpm -w install
cp apps/web/.env.example apps/web/.env
cp apps/hono-api/.env.example apps/hono-api/.env
cp apps/agents-cli/agents.config.example.json apps/agents-cli/agents.config.json
```

Run the development services:

```bash
pnpm dev:agents
pnpm dev:api
pnpm dev:web
```

Default URLs:

- Web: http://localhost:5173
- API: http://localhost:8788
- Agents Bridge: http://localhost:8799

More details: [docs/quickstart.md](docs/quickstart.md).

## Project Structure

```txt
apps/web          Nomi Web workspace
apps/hono-api     Local API and provider orchestration
apps/agents-cli   Local agent bridge and skills
packages          Shared schemas and protocols
docs              Public documentation
```

## Keywords

AI video editor, local AI video tool, open source AI video generator, AI storyboard workflow, script to image, script to video, image to video, AI canvas, local-first creative tool, AI agents, video generation workflow.

## License

Apache-2.0
