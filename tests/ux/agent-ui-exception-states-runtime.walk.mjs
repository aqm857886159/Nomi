#!/usr/bin/env node
// Runtime evidence for PR #447. This walk uses the real Electron renderer and
// the public ProjectAgentHost IPC bridge. It does not touch the renderer store
// or inject DOM: the exception records are appended by Host `item.put` and
// arrive through the same patch subscription as normal app state.
import fs from 'node:fs'
import path from 'node:path'
import { createRuntimeWalk, openCanvas, recorded } from './agent-runtime-walk-support.mjs'
import { expect } from './_assert.mjs'
import { flattenRequestText } from './agent-runtime-fixture.mjs'

const SHOT_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'shots', 'agent-exception-states-runtime')

function patchCatalog(settingsDir) {
  const catalogPath = path.join(settingsDir, 'model-catalog.json')
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  for (const model of catalog.models ?? []) model.published = true
  for (const vendor of catalog.vendors ?? []) vendor.authType = 'none'
  fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`)
}

async function appendHostItem(win, projectId, kind, status, label) {
  return win.evaluate(async ({ projectId: id, itemKind, itemStatus, itemLabel }) => {
    const record = await window.nomiDesktop.projects.readAsync(id)
    const binding = {
      projectId: id,
      immutableProjectUuid: record?.immutableProjectUuid,
      projectGeneration: record?.projectGeneration,
    }
    if (!binding.immutableProjectUuid || !Number.isSafeInteger(binding.projectGeneration)) {
      throw new Error(`project binding missing from readAsync: ${JSON.stringify(record)}`)
    }
    // Opening through the public bridge deliberately replaces the app's old
    // owner for this frame. The subsequent Host patch is still consumed by the
    // existing projection listener, which is the same production transport.
    const openedEnvelope = await window.nomiDesktop.projectAgent.open(binding)
    if (!openedEnvelope?.ok) throw new Error(`projectAgent.open failed: ${JSON.stringify(openedEnvelope)}`)
    const opened = openedEnvelope.value
    const turn = opened.snapshot.turns.at(-1)
    const threadId = opened.snapshot.activeThreadId ?? turn?.threadId
    if (!turn || !threadId) throw new Error(`no terminal turn available for ${itemLabel}`)
    const now = new Date().toISOString()
    const base = {
      itemId: `runtime-evidence-${crypto.randomUUID()}`,
      threadId,
      turnId: turn.turnId,
      status: itemStatus,
      retryable: true,
      deviated: false,
      createdAt: now,
      updatedAt: now,
    }
    const item = itemKind === 'failure'
      ? { ...base, kind: 'failure', code: 'runtime_fixture_failure', message: itemLabel, nextAction: 'retry' }
      : { ...base, kind: 'artifact', artifact: {
        runId: `runtime-evidence-run-${crypto.randomUUID()}`,
        artifactId: `runtime-evidence-artifact-${crypto.randomUUID()}`,
        version: 1,
        contentHash: 'runtime-evidence-content-hash',
      } }
    const resultEnvelope = await window.nomiDesktop.projectAgent.command({
      subscriptionId: opened.subscriptionId,
      clientCommandId: `runtime-evidence-command-${crypto.randomUUID()}`,
      knownRevision: opened.snapshot.hostRevision,
      type: 'item.put',
      payload: { item },
    })
    if (!resultEnvelope?.ok) throw new Error(`projectAgent.command failed: ${JSON.stringify(resultEnvelope)}`)
    await window.nomiDesktop.projectAgent.release(opened.subscriptionId)
    return { itemId: item.itemId, hostRevision: resultEnvelope.value.state.hostRevision, kind: itemKind, status: itemStatus }
  }, { projectId, itemKind: kind, itemStatus: status, itemLabel: label })
}

async function transitionHostItem(win, projectId, itemId, status) {
  return win.evaluate(async ({ projectId: id, targetItemId, nextStatus }) => {
    const record = await window.nomiDesktop.projects.readAsync(id)
    const binding = { projectId: id, immutableProjectUuid: record.immutableProjectUuid, projectGeneration: record.projectGeneration }
    const openedEnvelope = await window.nomiDesktop.projectAgent.open(binding)
    if (!openedEnvelope?.ok) throw new Error(`projectAgent.open failed: ${JSON.stringify(openedEnvelope)}`)
    const opened = openedEnvelope.value
    const now = new Date().toISOString()
    const resultEnvelope = await window.nomiDesktop.projectAgent.command({
      subscriptionId: opened.subscriptionId,
      clientCommandId: `runtime-evidence-transition-${crypto.randomUUID()}`,
      knownRevision: opened.snapshot.hostRevision,
      type: 'item.transition',
      payload: { itemId: targetItemId, status: nextStatus, retryable: true, deviated: false, updatedAt: now },
    })
    if (!resultEnvelope?.ok) throw new Error(`projectAgent.command failed: ${JSON.stringify(resultEnvelope)}`)
    await window.nomiDesktop.projectAgent.release(opened.subscriptionId)
    return { itemId: targetItemId, hostRevision: resultEnvelope.value.state.hostRevision, status: nextStatus }
  }, { projectId, targetItemId: itemId, nextStatus: status })
}

const walk = await createRuntimeWalk('agent-exception-states-runtime')
let failure
try {
  patchCatalog(path.join(walk.report.tempRoot, 'settings'))
  const { win } = await walk.start({ first: true })
  const { projectId } = await walk.newProject()
  await openCanvas(win)

  // Empty and collapsed are captured before any transcript item exists.
  await expect(win.locator('[data-agent-panel="true"]')).toBeVisible()
  await walk.snap('empty-expanded')
  await win.locator('[data-agent-collapse="true"]').click()
  await expect(win.locator('[data-agent-resident-collapsed="true"]')).toBeVisible()
  await walk.snap('collapsed')
  await win.locator('[data-agent-resident-collapsed="true"]').click()
  await expect(win.locator('[data-agent-panel="true"]')).toBeVisible()

  const reply = walk.fixture.expectText({
    label: 'establish a real terminal turn before Host exception evidence',
    match: (body) => flattenRequestText(body).includes('RUNTIME_EXCEPTION_EVIDENCE_BASE'),
    reply: { type: 'text', text: 'RUNTIME_EXCEPTION_EVIDENCE_ACK' },
  })
  await win.locator('[data-agent-input="true"]').fill('RUNTIME_EXCEPTION_EVIDENCE_BASE')
  await win.locator('[data-agent-composer-send="true"]').click()
  await recorded(reply.received, 'runtime evidence base conversation')
  await expect(win.locator('[data-agent-panel="true"]')).toContainText('RUNTIME_EXCEPTION_EVIDENCE_ACK')

  const loading = await appendHostItem(win, projectId, 'artifact', 'running', '生成中，正在准备预览')
  await expect(win.locator(`[data-agent-artifact-card="true"][data-state="loading"]`)).toBeVisible()
  await walk.snap('loading-artifact')

  const failed = await appendHostItem(win, projectId, 'failure', 'failed', '生成服务暂时无法返回结果')
  await expect(win.locator('[data-agent-failure-card="true"]')).toBeVisible()
  await win.locator('[data-agent-failure-card="true"]').screenshot({ path: path.join(walk.outputDir, '04-failure-card.png') })
  walk.report.screenshots.push(path.join(walk.outputDir, '04-failure-card.png'))

  const transitioned = await transitionHostItem(win, projectId, loading.itemId, 'failed')
  await expect(win.locator('[data-agent-artifact-card="true"][data-state="failed"]')).toBeVisible()
  await win.locator('[data-agent-artifact-card="true"][data-state="failed"]').screenshot({ path: path.join(walk.outputDir, '05-failed-artifact-card.png') })
  walk.report.screenshots.push(path.join(walk.outputDir, '05-failed-artifact-card.png'))

  walk.report.verified = {
    transport: 'real Electron renderer -> public projectAgent IPC -> production Host item.put/item.transition -> renderer patch',
    states: [
      { family: 'empty', evidence: '01-empty-expanded.png', selector: '[data-agent-panel="true"]' },
      { family: 'collapsed', evidence: '02-collapsed.png', selector: '[data-agent-resident-collapsed="true"]' },
      { family: 'loading', evidence: '03-loading-artifact.png', selector: '[data-agent-artifact-card="true"][data-state="loading"]', hostItem: loading },
      { family: 'error', evidence: '04-failure-card.png', selector: '[data-agent-failure-card="true"]', hostItem: failed },
      { family: 'error', evidence: '05-failed-artifact-card.png', selector: '[data-agent-artifact-card="true"][data-state="failed"]', hostItem: transitioned },
    ],
    not_claimed: ['plan failed', 'price failed', 'pinned card', 'full 17-state matrix'],
  }
} catch (error) {
  failure = error
} finally {
  await walk.finish(failure)
}

if (failure) process.exitCode = 1
if (!failure) {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  for (const source of walk.report.screenshots) {
    fs.copyFileSync(source, path.join(SHOT_DIR, path.basename(source)))
  }
  console.log(`Copied ${walk.report.screenshots.length} runtime screenshots to ${SHOT_DIR}`)
}
