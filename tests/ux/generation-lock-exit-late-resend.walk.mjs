#!/usr/bin/env node
// Adopted reviewer slow-provider path: a second paid intent requires explicit acknowledgement.
import { runLockExitRehearsal } from './_generationLockExitRehearsal.mjs'
import { lateResultOpenRunsJourney } from './_generationLockExitOpenRuns.mjs'
await runLockExitRehearsal(process.env.NOMI_LOCK_EXIT_LOCALE || 'zh-CN', async function i5bResend(input) { return lateResultOpenRunsJourney(input, true) })
