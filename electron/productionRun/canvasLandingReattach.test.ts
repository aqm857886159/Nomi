import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { createCanvasLandingHost } from './canvasLandingHost'
import { createProductionRunRepository } from './productionRunRepository'
import type { MaterializeShotsWirePayload } from './multiShotCanvasLanding'

// S1-5（2026-10-03）：生成途中切到项目库再切回来，节点还在，Run 却记下了 detached（切项目被误报成删除）。
// 打开项目时的对账把那一镜投成「只动已有节点」，渲染层回报「节点还在」的绑定——这条绑定必须真的写进 Run，
// 不能被「同一个命令号已经执行过」的幂等重放吞掉：最初那次绑定的命令号和这次一字不差，
// 重放只会原样返回当时的 Run，detached 永远纠正不回来（任务中心就一直说「缺画布节点」）。
// 这里用真仓库（真的命令号幂等表），不是假 command。

let root = ''
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-s15-reattach-')) })
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

const NOW = '2026-10-03T00:00:00.000Z'
const repository = () => createProductionRunRepository({ projectDirResolver: (id) => (id === 'project-1' ? root : null), now: () => NOW })
const candidate = { candidateId: 'cand-shot-1', revision: 1, moduleId: 'generation.single-shot', providerId: 'apimart', modelId: 'gpt-image-2',
  mode: 'text_to_image', prompt: '渔港清晨', parameters: {}, references: [] }

function landingHost(canvasNodeIds: Set<string>) {
  const payloads: MaterializeShotsWirePayload[] = []
  const host = createCanvasLandingHost({
    readRun: (projectId, runId) => repository().read(projectId, runId),
    command: async (projectId, runId, command) => repository().execute(projectId, runId, command as never),
    // 渲染层：节点 node-1 在画布上就回报它的绑定（与 materializeShots 的 existing-only 规则一致）。
    requestRenderer: async (_op, payload) => {
      const wire = payload as MaterializeShotsWirePayload
      payloads.push(wire)
      return { bindings: wire.shots.filter(() => canvasNodeIds.has('node-1')).map((shot) => ({ shotId: shot.shotId, nodeId: 'node-1' })) }
    },
    resolveProjectRoot: () => root,
    isProjectOpen: () => true,
  })
  return { host, payloads }
}

it('reported case: a shot falsely detached by a project switch is re-attached when the project reopens and its node is still there', async () => {
  repository().createGenerationDraft({ projectId: 'project-1', operationId: 'op-s15', candidate, origin: { host: 'nomi' },
    shots: [{ shotId: 'shot-1', candidate }] })
  const canvas = new Set(['node-1'])
  const { host, payloads } = landingHost(canvas)
  await host.landBeforeDispatch('project-1', 'op-s15')
  expect(repository().read('project-1', 'op-s15')!.generationPlan!.shots![0].nodeId).toBe('node-1')

  // 切项目那一下被误报成删除（修复前的观察者）。
  const bound = repository().read('project-1', 'op-s15')!
  repository().execute('project-1', 'op-s15', { commandId: 'detach-canvas.false-report', expectedRevision: bound.revision,
    type: 'plan.detach-shot-nodes', payload: { nodeIds: ['node-1'] }, issuedAt: NOW })
  expect(repository().read('project-1', 'op-s15')!.generationPlan!.shots![0].canvasDetached).toBe(true)

  // 打开项目补齐：节点还在 → 绑定写回，detached 纠正回来。
  expect(await host.reconcileExistingCanvas('project-1', 'op-s15')).toBe(true)
  expect(payloads.at(-1)!.shots[0]).toMatchObject({ shotId: 'shot-1', existingOnly: true })
  const healed = repository().read('project-1', 'op-s15')!.generationPlan!.shots![0]
  expect(healed.canvasDetached).toBeUndefined()
  expect(healed.nodeId).toBe('node-1')
})

it('class: a node the user really deleted stays detached — the reconciliation never re-binds or recreates it', async () => {
  repository().createGenerationDraft({ projectId: 'project-1', operationId: 'op-gone', candidate, origin: { host: 'nomi' },
    shots: [{ shotId: 'shot-1', candidate }] })
  const canvas = new Set(['node-1'])
  const { host } = landingHost(canvas)
  await host.landBeforeDispatch('project-1', 'op-gone')
  const bound = repository().read('project-1', 'op-gone')!
  repository().execute('project-1', 'op-gone', { commandId: 'detach-canvas.user-delete', expectedRevision: bound.revision,
    type: 'plan.detach-shot-nodes', payload: { nodeIds: ['node-1'] }, issuedAt: NOW })
  canvas.delete('node-1')

  await host.reconcileExistingCanvas('project-1', 'op-gone')
  expect(repository().read('project-1', 'op-gone')!.generationPlan!.shots![0].canvasDetached).toBe(true)
})

// CI 抓到（#966，canvas-shortcuts C19）：打开一个带老 Run 的项目，画布上 3 个节点变成 6 个——
// 打开项目的对账把从没落过画布（或身份认不出来）的镜头当成「缺的」新建了一份。
// 打开项目时的对账绝不新建节点：只给已经在、认得出是同一镜的节点补结果 / 纠正记录，认不出来就什么都不做。
it('reported case (C19): opening a project with a finished or withdrawn Run never adds nodes to the canvas', async () => {
  repository().createGenerationDraft({ projectId: 'project-1', operationId: 'op-c19', candidate, origin: { host: 'nomi' },
    shots: [{ shotId: 'shot-one', candidate }, { shotId: 'shot-two', candidate }] })
  const canvas = ['c19-source', 'c19-one', 'c19-two'] // 老资料：节点在，但没有落地章，Run 里也没有绑定
  const host = createCanvasLandingHost({
    readRun: (projectId, runId) => repository().read(projectId, runId),
    command: async (projectId, runId, command) => repository().execute(projectId, runId, command as never),
    // 渲染层落点的规则：existingOnly 的只认已有节点；否则缺的就建。
    requestRenderer: async (_op, payload) => {
      const wire = payload as MaterializeShotsWirePayload
      for (const shot of wire.shots) if (!(wire.existingOnly || shot.existingOnly)) canvas.push(`created-${shot.shotId}`)
      return { bindings: [] }
    },
    resolveProjectRoot: () => root,
    isProjectOpen: () => true,
  })
  await host.reconcileExistingCanvas('project-1', 'op-c19')
  expect(canvas).toEqual(['c19-source', 'c19-one', 'c19-two'])
})
