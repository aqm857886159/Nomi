# JSON Field Migration Plan

This is the safe migration plan for PostgreSQL JSON-like fields that are currently stored as `String` / `TEXT`.

## Scope

Primary fields found in `apps/hono-api/prisma/schema.prisma` and `apps/hono-api/schema.sql`:

- `agent_pipeline_runs.stages_json`
- `agent_pipeline_runs.progress_json`
- `agent_pipeline_runs.result_json`
- `api_request_logs.trace_json`
- `commerce_dictionaries.value_json`
- `daily_metric_snapshots.metrics_json`
- `ai_character_cards.tags_json`
- `ai_character_cards.modules_json`
- `ai_character_cards.copy_json`
- `ai_character_cards.style_json`
- `commerce_entitlements.result_json`
- `commerce_order_events.payload_json`
- `payment_webhook_events.payload_json`
- `payment_webhook_events.headers_json`

## Hard Rule

Do not run this against production without:

- a fresh database backup,
- a verified restore test,
- a staging migration run,
- and an application build against the migrated Prisma schema.

## Target Shape

In Prisma, each field above should become `Json` / `Json?`.

In PostgreSQL, each column should become `jsonb`, not plain `json`, so the data can be indexed and queried efficiently.

## Safe SQL Pattern

Use explicit casts only after validating that every non-null value is valid JSON:

```sql
SELECT id
FROM agent_pipeline_runs
WHERE stages_json IS NOT NULL
  AND jsonb_typeof(stages_json::jsonb) IS NULL;
```

Then migrate one table at a time:

```sql
ALTER TABLE agent_pipeline_runs
  ALTER COLUMN stages_json TYPE jsonb USING stages_json::jsonb,
  ALTER COLUMN progress_json TYPE jsonb USING progress_json::jsonb,
  ALTER COLUMN result_json TYPE jsonb USING result_json::jsonb;
```

If validation fails, stop. Fix the bad rows with an explicit data repair script before changing column types.

## Application Changes Required

After schema migration, remove manual `JSON.stringify` / `JSON.parse` wrappers at repository boundaries and pass structured values through Prisma directly.

Start with these files:

- `apps/hono-api/src/modules/agents/agents.repo.ts`
- `apps/hono-api/src/modules/agents/agents.service.ts`
- `apps/hono-api/src/modules/stats/stats.routes.ts`
- `apps/hono-api/src/modules/observability/request-logs.repo.ts`
- commerce and payment repositories/routes that read or write `payload_json`, `headers_json`, or `result_json`

Keep parsing at external API boundaries. Remove parsing only at the database boundary.

## Rollback Strategy

Rollback means converting `jsonb` back to `text`:

```sql
ALTER TABLE agent_pipeline_runs
  ALTER COLUMN stages_json TYPE text USING stages_json::text,
  ALTER COLUMN progress_json TYPE text USING progress_json::text,
  ALTER COLUMN result_json TYPE text USING result_json::text;
```

This is only a technical rollback. The operational rollback is restoring the pre-migration backup if application behavior diverges.
