import { openPaidWalk } from './_paidRun.mjs'
import { BRAIN, VIDEO } from './_agentVideoPaid.mjs'
import { runStoryboardAgentBulk } from './_storyboardAgentBulkSteps.mjs'

const IMAGE = { vendorKey: 'apimart', modelKey: 'gpt-image-2' }
const paid = await openPaidWalk('storyboard-agent-bulk-real.paid.mjs', 'storyboard-agent-bulk-real', [BRAIN, IMAGE, VIDEO], {
  buildMarkers: ['storyboardEditor.aspectScope.film'],
  recordAllowedBodies: true,
})
let failure
try {
  await runStoryboardAgentBulk({ walk: paid.walk, brainLabel: paid.label(BRAIN.vendorKey, BRAIN.modelKey), imageLabel: paid.label(IMAGE.vendorKey, IMAGE.modelKey) })
  const mediaPosts = paid.readAllowedRequests().filter(row => row.method === 'POST' && /images|videos|generations|tasks/.test(row.url ?? row.path ?? ''))
  if (mediaPosts.length) throw new Error('Editing the storyboard must not submit media generation')
} catch (error) { failure = error; process.exitCode = 1 }
finally { await paid.finish(failure) }
