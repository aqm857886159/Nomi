#!/usr/bin/env node
// Contract rehearsal: same sample loop, production request preview and Chat parser; no credentials, App or network.
// vitest is started through the current node binary, not a bare `pnpm` command, so it also runs on Windows.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { repoRoot } from '../../scripts/lib/repoPaths.mjs'

const vitest = path.join(repoRoot, 'node_modules/vitest/vitest.mjs')
const result = spawnSync(process.execPath, [vitest, 'run', 'electron/catalog/apimartLatestContracts.test.ts'], { cwd: repoRoot, stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
