# Nomi API

Local API for Nomi workspace orchestration, model provider integration, and asset/task persistence.

## Run

```bash
cp .env.example .env
pnpm prisma:generate
pnpm dev
```

## Main responsibilities

- Auth and user scoping
- Project and asset persistence
- Provider integration
- Task execution and polling
- Public and workbench chat endpoints

## Notes

- Keep secrets in local env files.
- Keep provider failures explicit.
- Avoid silent fallback behavior.
