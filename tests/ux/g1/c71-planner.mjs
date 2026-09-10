import fs from 'node:fs'
import path from 'node:path'
import { stationTimeout } from '../_station-budget.mjs'
import { CREATION_PANEL, APPROVAL_CARD, INTERVENTION_CONFIRM, DOCUMENT } from '../agent-runtime-walk-support.mjs'
import { readLaneTranscripts, laneMessages } from '../agent-lane-observer.mjs'
import { selectPlannerInUi } from './sweep-real.mjs'
import { waitForPlannerTerminal } from './sweep-c0.mjs'
import { scorePlanner } from './c0-r30.mjs'
import { expect, screenshotSettled } from '../_assert.mjs'
export function twoShotScript(quote) {
  return `# 清晨的落叶\n\n五约束：\n1. 只做两镜，每镜 ${quote.params.duration} 秒，共 ${quote.params.duration * quote.shots} 秒；16:9。\n2. 第一镜：清晨河边的树木，阳光穿过树叶，广角固定镜头，微风吹动叶片。第二镜：水面近景，一片落叶随涟漪漂远，阳光倒影，镜头缓缓推进。\n3. 两镜均为纯文生视频（t2v），模型 ${quote.model}，resolution=${quote.resolution}，size=16:9；不生成图片、参考图或锚点卡。\n4. 无人物、无字幕、无对白。\n5. 提交分镜提案待我审批，不直接调用生成；第一镜prompt必须以“C71-S1：”开头，第二镜prompt必须以“C71-S2：”开头。\n`
}
export async function selectPlanner(win, quote) { await selectPlannerInUi(win, quote.planner.label ?? quote.planner.model) }
export function plannerMetrics(projectRoot, domainComplete) {
  const messages = readLaneTranscripts(projectRoot).flatMap(laneMessages)
  const calls = messages.filter(m => m.role === 'assistant').flatMap(m => Array.isArray(m.content) ? m.content : [])
    .filter(p => p.type === 'toolCall' && p.name === 'nomi_storyboard_write')
  const correct = calls.filter(call => messages.some(m => m.role === 'toolResult' && m.toolCallId === call.id && m.isError === false)).length
  return { ...scorePlanner(messages, domainComplete), toolWriteRate: { correct, attempted: calls.length,
    percent: calls.length ? correct / calls.length * 100 : null }, source: 'native lane transcript; no fixture result substitution' }
}
export async function planTwoShots({ win, project, payload, quote, report, directory }) {
  report.r30 = plannerMetrics(project.rootPath, false)
  await win.locator(DOCUMENT).click(); await win.locator(DOCUMENT).selectText()
  await win.locator('.workbench-selection-popover').getByRole('button', { name: '拆成镜头', exact: true }).click()
  const approval = win.locator(`${CREATION_PANEL} ${APPROVAL_CARD}`)
  try {
    await waitForPlannerTerminal({ approval, projectRoot: project.rootPath, win, directory })
    await expect(approval).toBeVisible()
    await screenshotSettled(win, { path: path.join(directory, '02-approval.png') })
    report.plannerCheckpoint = 'approval-visible'
    await approval.locator(INTERVENTION_CONFIRM).click()
    report.plannerCheckpoint = 'waiting-complete-persisted-plan'
    await expect.poll(async () => {
      const p = await payload()
      const shots = p.storyboardDesignsByDocumentId?.[p.activeDocumentId]?.[0]?.plan?.shots ?? []
      report.plannerObservation = shots.map((s,i) => ({ model: s.modelKey, duration: s.durationSec, prefix: s.prompt?.startsWith(`C71-S${i + 1}：`) }))
      return report.plannerObservation
    }, { timeout: stationTimeout({ turns: 1, operations: 0 }) }).toEqual(Array.from({ length: quote.shots }, () => ({ model: quote.model, duration: quote.params.duration, prefix: true })))
    report.plannerCheckpoint = 'waiting-native-turn-terminal'
    await expect.poll(() => plannerMetrics(project.rootPath, true).turns, { timeout: stationTimeout({ turns: 1, operations: 0 }) }).toBe('1/1 (100%)')
    report.plannerCheckpoint = 'native-turn-complete'
    report.r30 = plannerMetrics(project.rootPath, true)
    expect(report.r30.toolWriteRate.correct).toBeGreaterThan(0)
    expect(report.r30.toolWriteRate.correct).toBe(report.r30.toolWriteRate.attempted)
    fs.writeFileSync(path.join(directory, 'r30.json'), JSON.stringify(report.r30, null, 2))
    await win.locator('[data-storyboard-id]').first().click()
  } finally {
    if (!report.r30?.toolWriteRate?.correct) report.r30 = plannerMetrics(project.rootPath, false)
  }
}
