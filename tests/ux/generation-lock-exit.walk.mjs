#!/usr/bin/env node
import { runLockExitRehearsal } from './_generationLockExitRehearsal.mjs'
import { threePageLockExitJourney } from './_generationLockExitThreePages.mjs'
import { listEntryLockExitJourney } from './_generationLockExitListChecks.mjs'
import { a4LockExitJourney } from './_generationLockExitSteps.mjs'
import { httpEightLockExitJourney } from './_generationLockExitHttpEight.mjs'
import { matrixLockExitJourney } from './_generationLockExitMatrix.mjs'
import { editedStoryboardLockExitJourney, editedCanvasLockExitJourney, editedListLockExitJourney } from './_generationLockExitEditedQueue.mjs'
import { agentMountedLockExitJourney, agentUnmountedLockExitJourney } from './_generationLockExitAgent.mjs'
const journeys = process.argv.includes('--agent') ? [agentMountedLockExitJourney, agentUnmountedLockExitJourney] : process.argv.includes('--edit-queue') ? [editedStoryboardLockExitJourney, editedCanvasLockExitJourney, editedListLockExitJourney] : process.argv.includes('--http-eight') ? [httpEightLockExitJourney] : process.argv.includes('--matrix') ? [matrixLockExitJourney] : process.argv.includes('--a4') ? [a4LockExitJourney] : process.argv.includes('--list-entry') ? [listEntryLockExitJourney] : [threePageLockExitJourney, listEntryLockExitJourney]
for (const locale of ['zh-CN', 'en']) for (const journey of journeys) {
  try { await runLockExitRehearsal(locale, journey) }
  catch (error) { process.exitCode = 1; console.error(`${locale}/${journey.name}: ${error.message}`) }
}
