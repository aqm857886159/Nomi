#!/usr/bin/env node
// 真实用户任务：付费卡上点了「生成这张」，确认还在路上就立刻点 ×（确认中立刻关闭）。
// 2026-10-10 仲裁器（docs/plan/2026-10-10-spend-arbiter.md）：× 同步登记取消令牌，确认在每个有副作用的步骤前问同一枚；
// 谁先到都只能有一个终态——回执里在生成的 = 宿主批下的 = 供应商收到的，× 之后没交出去的不再交；× 回给卡的那一句和账本一致。
// 两下都走 locator（不再一次采样坐标连点）。中英各一遍，各开一个新项目。零额度：远端供应商是 loopback 夹具，其余全是真的。
import { clickOrFail, expect } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { createPresenter } from './_spendRemainingWalk.mjs'
import { singleStopRound } from './_spendStopRounds.mjs'
import { CANVAS_PANEL, createRuntimeWalk, expandResidentPanel, openCanvas } from './agent-runtime-walk-support.mjs'
import { backToLibrary, newProjectEntry } from './_shell.mjs'

process.env.NOMI_WALK_UNPRICED_MODEL = '1'

const present = createPresenter('S_CLOSE')
const walk = await createRuntimeWalk('spend-confirm-then-close', { generationProvider: 'apimart' })
let failure
try {
  const { win } = await walk.start({ first: true })
  const zhProject = await walk.newProject()
  await openCanvas(win)
  await singleStopRound(walk, win, zhProject.projectId, 'zh', { present, mode: 'immediate' })

  await backToLibrary(win, { timeout: stationTimeout({ operations: 4 }) })
  await win.evaluate(() => localStorage.setItem('nomi:locale:v1', 'en'))
  await win.reload()
  await clickOrFail(newProjectEntry(win), 'en：新建空白项目', { timeout: stationTimeout({ operations: 4 }) })
  await clickOrFail(win.getByRole('button', { name: 'Generate', exact: true }), 'en：生成工作区', { timeout: stationTimeout({ operations: 4 }) })
  await expect(win.locator('.generation-canvas-v2__stage'), 'en：生成画布').toBeVisible({ timeout: stationTimeout({ operations: 4 }) })
  const enProjectId = await win.evaluate(() => {
    const url = new URL(location.href)
    return url.searchParams.get('projectId') ?? new URLSearchParams(url.hash.split('?')[1] ?? '').get('projectId')
  })
  expect(enProjectId, 'en：新项目的 id').toMatch(/^project-/)
  expect(enProjectId, 'en：是另开的新项目').not.toBe(zhProject.projectId)
  await expandResidentPanel(win)
  await expect(win.locator(`${CANVAS_PANEL} [data-v4-control="input"]`), 'en：Agent 面板的输入框在').toBeVisible({ timeout: stationTimeout({ operations: 4 }) })
  await singleStopRound(walk, win, enProjectId, 'en', { present, mode: 'immediate' })

  walk.report.verified = [
    'confirm-then-immediate-close-has-one-terminal',
    'receipt-generating-equals-authorized-equals-vendor-received',
    'stop-sentence-agrees-with-durable-host-state',
  ]
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await walk.finish(failure)
}
