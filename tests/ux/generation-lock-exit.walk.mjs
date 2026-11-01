#!/usr/bin/env node
import { runLockExitRehearsal } from './_generationLockExitRehearsal.mjs'
import { threePageLockExitJourney } from './_generationLockExitThreePages.mjs'
import { listEntryLockExitJourney } from './_generationLockExitListChecks.mjs'
const journeys = process.argv.includes('--list-entry') ? [listEntryLockExitJourney] : [threePageLockExitJourney, listEntryLockExitJourney]
for (const locale of ['zh-CN', 'en']) for (const journey of journeys) {
  try { await runLockExitRehearsal(locale, journey) }
  catch (error) { process.exitCode = 1; console.error(`${locale}/${journey.name}: ${error.message}`) }
}
