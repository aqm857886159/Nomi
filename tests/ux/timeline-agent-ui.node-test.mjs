import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8')

test('timeline Agent UI exposes a complete proposal lifecycle', () => {
  const card = read('src/workbench/generationCanvas/components/TimelineEditPlanCard.tsx')
  const timeline = read('src/workbench/generationCanvas/components/AssistantTimeline.tsx')
  const panel = read('src/workbench/generationCanvas/components/CanvasAssistantPanel.tsx')
  const hook = read('src/workbench/generationCanvas/components/useTimelineAgentUi.ts')
  const locale = read('src/i18n/locales/timelineEditor.ts')

  assert.match(card, /data-timeline-edit-plan-card=\{mode\}/)
  assert.match(card, /data-timeline-edit-plan-confirm/)
  assert.match(card, /data-timeline-edit-plan-undo/)
  assert.match(card, /role="alert"/)
  assert.match(card, /aria-expanded=\{detailsOpen\}/)

  assert.match(timeline, /timelinePlanPreviews/) // read-only preview is visible
  assert.match(timeline, /toolName === 'apply_edit_plan'/) // pending apply is a first-class card
  assert.match(timeline, /timelineApplied/) // applied and failed states remain visible
  assert.match(hook, /applyTimelineToolCall\('undo_timeline_edit'/) // explicit user undo uses the canonical tool
  assert.match(panel, /event\.toolName === 'propose_edit_plan'/) // preview result is captured from the real tool call

  assert.match(locale, /agent: \{/) // zh and en blocks are kept in one locale source
  assert.match(locale, /previewReady:/)
  assert.match(locale, /undoFailedDetail:/)
})
