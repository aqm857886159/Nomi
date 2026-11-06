#!/usr/bin/env node
// Contract rehearsal: same sample loop, production request preview and Chat parser; no credentials, App or network.
import { spawnSync } from 'node:child_process'
const result = spawnSync('pnpm', ['exec', 'vitest', 'run', 'electron/catalog/apimartLatestContracts.test.ts'], { stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
