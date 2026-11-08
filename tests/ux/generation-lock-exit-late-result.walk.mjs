#!/usr/bin/env node
// Adopted reviewer slow-provider path: cancel leaves recovery, retrieval is free.
import { runLockExitRehearsal } from './_generationLockExitRehearsal.mjs'
import { lateResultOpenRunsJourney } from './_generationLockExitOpenRuns.mjs'
await runLockExitRehearsal(process.env.NOMI_LOCK_EXIT_LOCALE || 'zh-CN', async function i5LateResult(input) { return lateResultOpenRunsJourney(input) })
