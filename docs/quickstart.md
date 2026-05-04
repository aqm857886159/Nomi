# Nomi Quickstart

## Requirements

- Node.js 20+
- pnpm 10+
- PostgreSQL 16+
- Redis 7+

### macOS (Homebrew)

```bash
brew install postgresql@16 redis
brew services start postgresql@16
brew services start redis
```

### Windows / Linux

Install [PostgreSQL](https://www.postgresql.org/download/) and [Redis](https://redis.io/docs/install/) manually, or use Docker:

```bash
docker run -d --name nomi-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
docker run -d --name nomi-redis -p 6379:6379 redis:7
```

## Install

```bash
git clone https://github.com/aqm857886159/Nomi.git
cd Nomi
pnpm install
```

## Configure

```bash
cp apps/hono-api/.env.example apps/hono-api/.env
```

Edit `apps/hono-api/.env` and set your PostgreSQL connection:

```env
DATABASE_URL=postgresql://YOUR_USER@localhost:5432/nomi_dev
JWT_SECRET=any-random-string
REDIS_URL=redis://localhost:6379
```

Create the database:

```bash
psql postgres -c "CREATE DATABASE nomi_dev;"
```

## Run

Open three terminals:

```bash
# Terminal 1 — API (port 8788)
pnpm dev:api

# Terminal 2 — Web (port 5173)
pnpm dev:web

# Terminal 3 — Agents (optional, needed for AI model integration)
pnpm dev:agents
```

Open http://localhost:5173.

## Add a model provider

Go to **Settings → Model Catalog** and use the AI integration assistant to add any provider (KIE AI, OpenAI-compatible, etc.) by pasting the docs URL or a curl example.
