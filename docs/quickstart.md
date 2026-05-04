# Nomi Quickstart

## Requirements

- Node.js 20+
- pnpm 10+
- PostgreSQL 16+

## Install

```bash
git clone https://github.com/aqm857886159/Nomi.git
cd Nomi
pnpm -w install
```

## Configure

```bash
cp apps/web/.env.example apps/web/.env
cp apps/hono-api/.env.example apps/hono-api/.env
cp apps/agents-cli/agents.config.example.json apps/agents-cli/agents.config.json
```

Use your own API keys and provider endpoints. Do not commit real secrets.

## Run

Use three terminals:

```bash
pnpm dev:agents
pnpm dev:api
pnpm dev:web
```

Open http://localhost:5173.

## Verify

```bash
pnpm build:web
pnpm build:api
pnpm build:agents
```
