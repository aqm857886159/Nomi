import { shots, MODEL } from './c0-fixture.mjs'
import { REAL_MODELS } from './c0-real-budget.mjs'

export function c0RepairPlan(mode) {
  return { title: '日落前的一分钟', anchors: [], shots: shots.map(shot => ({ ...shot,
    anchorIds: [], modelKey: mode === 'real' ? REAL_MODELS.video : MODEL, modeId: 't2v',
    params: { duration: 8, size: '16:9', resolution: '768P' },
  })) }
}

// Explicit test-side intervention. Caller must record failure + repair before using later stations.
export async function repairStoryboard(win, projectId, { title, shots }) {
  const saved = await win.evaluate(async ({ projectId, title, shots }) => {
    const record = await window.nomiDesktop.projects.readAsync(projectId)
    const p = record.payload, documentId = p.activeDocumentId
    if (!documentId) throw Error('Cannot repair without an actual document')
    const now = Date.now(), designId = 'sweep-repaired-storyboard'
    p.storyboardDesignsByDocumentId = { ...p.storyboardDesignsByDocumentId, [documentId]: [{
      id: designId, documentId, title, committed: false, status: 'draft',
      createdAt: now, updatedAt: now, sourceDocumentUpdatedAt: now,
      plan: { title, anchors: [], shots },
    }] }
    p.activeStoryboardId = designId
    return window.nomiDesktop.projects.save(projectId, record)
  }, { projectId, title, shots })
  if (!saved) throw Error('Fixture persistence did not return a receipt')
  await win.reload({ waitUntil: 'domcontentloaded' })
  await win.getByRole('button', { name: '创作', exact: true }).click()
  await win.locator('[data-storyboard-id]').first().click()
}
