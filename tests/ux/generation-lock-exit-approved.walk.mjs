import { runLockExitRehearsal } from './_generationLockExitRehearsal.mjs'
import { approvedUnknownResultCardJourney } from './_generationLockExitApprovedCard.mjs'
for (const locale of ['zh-CN', 'en']) {
  try { await runLockExitRehearsal(locale, approvedUnknownResultCardJourney) }
  catch (error) { console.error(error); process.exitCode = 1 }
}
