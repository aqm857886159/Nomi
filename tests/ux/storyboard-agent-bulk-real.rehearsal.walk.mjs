import { createRuntimeWalk, hasToolResult, toolNames } from './agent-runtime-walk-support.mjs'
import { FIXTURE_IMAGE_MODEL_LABEL, FIXTURE_TEXT_MODEL_LABEL } from './agent-runtime-fixture.mjs'
import { runStoryboardAgentBulk } from './_storyboardAgentBulkSteps.mjs'

const walk = await createRuntimeWalk('storyboard-agent-bulk-rehearsal', { generationProvider: 'apimart' })
let design
let shotIds
walk.fixture.respond({
  label: 'storyboard bulk edit rehearsal',
  match: body => Boolean(design) && toolNames(body).includes('draft_shots'),
  reply: body => {
    const shotId = shotIds.find(id => !hasToolResult(body, `storyboard-bulk-edit-${id}`))
    return shotId ? { type: 'tool', id: `storyboard-bulk-edit-${shotId}`, name: 'draft_shots', args: {
      operationId: design.id,
      shots: [{ shotId, taskKind: 'text_to_video', candidate: { providerId: 'apimart', modelId: 'doubao-seedance-2.0' }, aspectRatio: '9:16' }],
    } } : { type: 'text', text: '已修改选中的镜头，未请求生成。' }
  },
})
let failure
try {
  await runStoryboardAgentBulk({ walk, brainLabel: FIXTURE_TEXT_MODEL_LABEL, imageLabel: FIXTURE_IMAGE_MODEL_LABEL, beforeSend: input => { design = input.design; shotIds = input.shotIds } })
} catch (error) { failure = error; process.exitCode = 1 }
finally { await walk.finish(failure, { unscriptedFixture: true }) }
