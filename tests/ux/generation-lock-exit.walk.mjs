#!/usr/bin/env node
import path from 'node:path'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { runLockExitRehearsal } from './_generationLockExitRehearsal.mjs'
import { threePageLockExitJourney } from './_generationLockExitThreePages.mjs'
import { listEntryLockExitJourney } from './_generationLockExitListChecks.mjs'
import { a4LockExitJourney } from './_generationLockExitSteps.mjs'
import { httpEightLockExitJourney } from './_generationLockExitHttpEight.mjs'
import { matrixLockExitJourney } from './_generationLockExitMatrix.mjs'
import { editedStoryboardLockExitJourney, editedCanvasLockExitJourney, editedListLockExitJourney } from './_generationLockExitEditedQueue.mjs'
import { agentMountedLockExitJourney, agentUnmountedLockExitJourney } from './_generationLockExitAgent.mjs'
import { singleActionsLockExitJourney, spendChangeLockExitJourney, queueActionsLockExitJourney } from './_generationLockExitSingleActions.mjs'
const journeys = process.argv.includes('--queued-actions') ? [queueActionsLockExitJourney] : process.argv.includes('--spend-change') ? [spendChangeLockExitJourney] : process.argv.includes('--three-pages') ? [threePageLockExitJourney] : process.argv.includes('--single-actions') ? [singleActionsLockExitJourney] : process.argv.includes('--agent') ? [agentMountedLockExitJourney, agentUnmountedLockExitJourney] : process.argv.includes('--edit-queue') ? [editedStoryboardLockExitJourney, editedCanvasLockExitJourney, editedListLockExitJourney] : process.argv.includes('--http-eight') ? [httpEightLockExitJourney] : process.argv.includes('--matrix') ? [matrixLockExitJourney] : process.argv.includes('--a4') ? [a4LockExitJourney] : process.argv.includes('--list-entry') ? [listEntryLockExitJourney] : [threePageLockExitJourney, listEntryLockExitJourney]
const out = makeTempDir('nomi-generation-lock-exit-')
process.env.EVIDENCE_DIR ||= out
process.env.NOMI_LOCK_EXIT_OUT ||= out
process.env.NOMI_LOCK_EXIT_SHOTS ||= path.join(out, 'shots')
for (const locale of ['zh-CN', 'en']) for (const journey of journeys) {
  try { await runLockExitRehearsal(locale, journey) }
  catch (error) { process.exitCode = 1; console.error(`${locale}/${journey.name}: ${error.message}`) }
}
