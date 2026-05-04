# Nomi Agents CLI

Local agent runtime for Nomi.

## Purpose

- Load skills on demand
- Coordinate multi-step work
- Keep durable session and memory state
- Support subagents, tools, and task graph execution

## Run

```bash
cd apps/agents-cli
npm install
npm run dev -- run "plan a small Nomi feature"
```

## Notes

- Use explicit failure instead of silent fallback.
- Keep skills generic and composable.
- Preserve local-first behavior.
