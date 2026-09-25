// 任务面板「乱 + 状态对不上」R13 走查（用户 2026-09-25 反馈，PR claude/agent-panel-tidy）。
// 用法: NOMI_EVIDENCE_LABEL=before|after node tests/ux/task-center-states.walk.mjs（缺省 after）
// 产出: docs/evidence/2026-09-25-agent-panel-tidy/task-center-<label>-<zh|en>.png + task-center-<label>.json
//
// 现场按用户截图摆，全部走真 app、真 IPC、真磁盘：
//   · 两份 Agent 草稿 run —— 事件日志原样取自一次真实 Agent 对话走查（tests/ux/fixtures/task-center-agent-drafts/，
//     同一段对话里 Agent 先拟了 3 镜、又拟了 1 镜，两份都停在 draft、没提交、没花钱）；
//   · 一份在跑的多镜生成 run：最近一镜供应商 6 分钟没回新状态（「供应商长时间没有返回新状态」那张卡）；
//   · 画布队列 5 行：视频 ×2、相机店内景成功，小鹿、老陈等待超时（可重新拉取）。
// 队列经 window.__nomiQueueStore / __nomiCanvasStore（仅 localStorage.__nomiE2E==='1' 暴露）用真 store 的真 action 摆出。
//
// 断言的是用户那句话里的三件事，每件都要在面板**里**读（不扫整页）：
//   ① 界面不露内部代号（generation.single-shot 这类 run kind）；
//   ② 「等待超时 / 可重新拉取」不在「已完成」组；卡上的状态词、标题、阶段计数说同一件事；
//   ③ 同一次制作不再是一张卡 + 两行「等待开始」——没提交的 Agent 草稿不算任务。
// NOMI_EVIDENCE_LABEL=before 跑在修复前的构建上：截图与观测照常落盘，断言红 = 复现证据。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { DEFAULT_TIMEOUT_MS, clickOrFail, expect, expectAbsent, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// 标签走环境变量：runtime walk 的启动器只认 `--packaged <path>` 一种参数。
const label = process.env.NOMI_EVIDENCE_LABEL || 'after'
if (!['before', 'after'].includes(label)) throw new Error('Usage: NOMI_EVIDENCE_LABEL=before|after node tests/ux/task-center-states.walk.mjs')
const outDir = path.join(repoRoot, 'docs/evidence/2026-09-25-agent-panel-tidy')
fs.mkdirSync(outDir, { recursive: true })
const fixtureDir = path.join(repoRoot, 'tests/ux/fixtures/task-center-agent-drafts')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-task-center-states-'))

const PANEL = '[data-nomi-right-panel="tasks"]'
const STALE_RUN_ID = 'op-walk-stale-multishot'
/** 修复前卡片/行里会露出的内部代号：run kind、playbook 名一类「小写.小写」的点分标识。 */
const INTERNAL_CODE = /\b(?:generation\.single-shot|brand\.promo|[a-z]+\.[a-z]+(?:-[a-z]+)+)\b/

/** 把真实 Agent 草稿的事件日志落进本次项目（只换 projectId，其余字节不动）。 */
function writeAgentDrafts(projectDir, projectId) {
  for (const file of fs.readdirSync(fixtureDir).filter((name) => name.endsWith('.events.ndjson'))) {
    const runId = file.replace('.events.ndjson', '')
    const source = fs.readFileSync(path.join(fixtureDir, file), 'utf8')
    const originalProjectId = JSON.parse(source.split('\n')[0]).payload.run.projectId
    const dir = path.join(projectDir, '.nomi', 'runs', runId)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'events.ndjson'), source.split(originalProjectId).join(projectId), 'utf8')
  }
}

/**
 * 在跑的多镜生成 run：形状取自同一份真实草稿（3 镜、4 个阶段），推进到「已提交、在轮询」。
 * 最近一镜的 lastVendorStateChangeAt 落在 6 分钟前 → 过了 2 分钟的陈旧阈值，卡片走 providerStale 分支。
 * 只写 events.ndjson（repository.read 自己从事件重建并补快照），不在走查里复刻 checksum。
 */
function writeStaleRun(projectDir, projectId) {
  const draftSource = fs.readFileSync(path.join(fixtureDir, 'op-1275b8e6-b11c-4d75-997d-208a711a1383.events.ndjson'), 'utf8')
  const draft = JSON.parse(draftSource.trim().split('\n').at(-1)).payload.run
  const now = Date.now()
  const iso = (offsetMs) => new Date(now - offsetMs).toISOString()
  const shots = draft.generationPlan.shots.map((shot, index) => ({ ...shot, title: ['相机店内景', '小鹿', '老陈'][index] }))
  const job = (index, status, updatedAgoMs, extra = {}) => ({
    jobId: `job-walk-${index + 1}`, stageId: 'generate', status, attempt: 1,
    provider: 'apimart', model: 'gpt-image-2', idempotencyKey: `walk-${index + 1}`,
    nodeId: shots[index].nodeId, createdAt: iso(10 * 60_000), updatedAt: iso(updatedAgoMs), ...extra,
  })
  const run = {
    ...draft,
    runId: STALE_RUN_ID,
    projectId,
    status: 'running',
    stages: draft.stages.map((stage) => (stage.stageId === 'generate' ? { ...stage, status: 'running', startedAt: iso(10 * 60_000) } : stage)),
    generationPlan: { ...draft.generationPlan, operationId: STALE_RUN_ID, state: 'submitted', cardHidden: false, shots, updatedAt: iso(10 * 60_000) },
    jobs: [
      job(0, 'adopted', 5 * 60_000),
      job(1, 'polling', 20_000, { lastVendorStateChangeAt: iso(6 * 60_000), providerTaskId: 'task-walk-2' }),
      job(2, 'polling', 30_000, { lastVendorStateChangeAt: iso(6 * 60_000), providerTaskId: 'task-walk-3' }),
    ],
    budget: { ...draft.budget, authorized: 3, reserved: 2, actual: 1 },
    createdAt: iso(10 * 60_000),
    updatedAt: iso(0),
  }
  const dir = path.join(projectDir, '.nomi', 'runs', STALE_RUN_ID)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'events.ndjson'), `${JSON.stringify({
    schemaVersion: 1, eventId: 'evt-walk-stale-1', cursor: 1, runId: STALE_RUN_ID, runRevision: 0,
    commandId: `generation.create:${STALE_RUN_ID}`, type: 'run.created', message: 'walk fixture',
    emittedAt: run.updatedAt, stageId: 'generate', payload: { run },
  })}\n`, 'utf8')
}

/** 面板里读出来的一切（行、组、卡）。只在面板这棵子树里读，不碰整页文本。 */
async function observe(panel) {
  return await panel.evaluate((root) => {
    const text = (element) => (element?.innerText ?? '').replace(/\s+/g, ' ').trim()
    const sectionOf = (element) => element.closest('[data-task-group]')?.getAttribute('data-task-group') ?? null
    return {
      sections: [...root.querySelectorAll('[data-task-section]')].map((element) => ({
        group: element.getAttribute('data-task-section'), text: text(element),
      })),
      rows: [...root.querySelectorAll('[data-task-id]')].map((element) => ({
        id: element.getAttribute('data-task-id'), group: element.getAttribute('data-task-group'), text: text(element),
        action: element.querySelector('[data-task-action]')?.getAttribute('data-task-action') ?? null,
      })),
      cards: [...root.querySelectorAll('[data-production-task-card]')].map((element) => ({
        group: sectionOf(element),
        tone: element.querySelector('[data-production-tone]')?.getAttribute('data-production-tone') ?? null,
        chip: text(element.querySelector('[data-production-tone]')),
        title: text(element.querySelector('[data-production-status-title]')),
        text: text(element),
      })),
      panel: text(root),
    }
  })
}

async function openTaskPanel(win) {
  await clickOrFail(win.locator('[data-task-center-trigger="true"]'), '顶栏「任务」按钮')
  const panel = win.locator(PANEL)
  await expectVisible(panel, '任务面板')
  await expectVisible(panel.locator('[data-production-task-card]'), '在跑的那份制作的完整卡')
  return panel
}

async function closeTaskPanel(win) {
  await win.keyboard.press('Escape')
  await expect(win.locator(PANEL)).toHaveCount(0)
}

async function switchToEnglish(win) {
  await clickOrFail(win.getByRole('button', { name: /^(设置|Settings)$/ }).first(), '顶栏「设置」按钮')
  await clickOrFail(win.locator('[data-settings-tab-id="general"]'), '设置导航「通用」')
  await clickOrFail(win.locator('[data-settings-locale="en"]'), '语言切到 English')
  await expectVisible(win.locator('[data-settings-locale="en"][aria-pressed="true"]'), '语言分段控件已选中 English')
  await clickOrFail(win.locator('[data-settings-close]'), '关闭设置')
}

const evidence = { label, observations: {} }
let app
try {
  let win
  ;({ app, win } = await launchNomiApp({
    name: 'task-center-states', tempRoot, settleMs: 0,
    initialLocalStorage: {
      __nomiE2E: '1', 'nomi:locale:v1': 'zh-CN', 'nomi-color-scheme': 'light',
      'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen',
    },
  }))
  await win.setViewportSize({ width: 1280, height: 860 })
  await clickOrFail(win.getByRole('button', { name: /^新建空白项目/ }), '新建空白项目')
  await win.waitForFunction(() => window.location.hash.includes('projectId='), undefined, { timeout: DEFAULT_TIMEOUT_MS })
  const projectId = await win.evaluate(() => new URLSearchParams(window.location.hash.split('?')[1] || '').get('projectId'))
  const project = (await win.evaluate(() => window.nomiDesktop.projects.listAsync())).find((item) => item.id === projectId)
  if (!project?.rootPath) throw new Error(`没拿到项目目录：${projectId}`)

  await clickOrFail(win.getByRole('button', { name: /^生成$/ }).first(), '切到「生成」区')
  await win.waitForFunction(() => Boolean(window.__nomiCanvasStore && window.__nomiQueueStore), undefined, { timeout: DEFAULT_TIMEOUT_MS })
  await win.evaluate((pid) => {
    const canvas = window.__nomiCanvasStore.getState()
    const add = (title, kind) => canvas.addNode({ kind, title }).id
    const ids = { lao: add('老陈', 'image'), shop: add('相机店内景', 'image'), deer: add('小鹿', 'image'), v1: add('视频', 'video'), v2: add('视频', 'video') }
    window.__nomiCanvasStore.getState().updateNode(ids.lao, { status: 'recoverable' })
    window.__nomiCanvasStore.getState().updateNode(ids.deer, { status: 'recoverable' })
    const queue = window.__nomiQueueStore
    queue.setState({ entries: [], batches: {} })
    const order = [ids.lao, ids.shop, ids.deer, ids.v1, ids.v2]
    const batchId = queue.getState().enqueueBatch([order], pid)
    for (const id of order) {
      queue.getState().markRunning(batchId, id)
      queue.getState().markSettled(batchId, id, id === ids.lao || id === ids.deer ? 'error' : 'success')
    }
  }, projectId)
  writeAgentDrafts(project.rootPath, projectId)
  writeStaleRun(project.rootPath, projectId)
  const listed = await win.evaluate((pid) => window.nomiDesktop.productionRuns.list(pid), projectId)
  evidence.listedRuns = listed.map((run) => ({ runId: run.runId, status: run.status, plan: run.generationPlan?.state ?? null, jobs: run.jobs?.length ?? null }))
  expect(listed.map((run) => run.runId).sort(), '盘上三份 run 都读得到（两份 Agent 草稿 + 一份在跑）').toEqual([
    'op-1275b8e6-b11c-4d75-997d-208a711a1383', 'op-c4f4819c-b7a0-4588-bdb1-03280e6fbbd7', STALE_RUN_ID,
  ].sort())

  for (const locale of ['zh', 'en']) {
    if (locale === 'en') await switchToEnglish(win)
    const panel = await openTaskPanel(win)
    // 行出现在面板里之后再拍（队列行是同步渲染的；制作行跟 1.5s 的列表轮询）。
    await expectVisible(panel.locator('[data-task-id]').filter({ hasText: /小鹿/ }), '「小鹿」那一行')
    // 不 hover、不展开：按钮在静止的面板里就看得见。
    await expectVisible(panel.locator('[data-task-id]').filter({ hasText: /小鹿/ }).locator('[data-task-action="recover_generation"]'), '「小鹿」行上的重新拉取按钮')
    await screenshotSettled(panel, { path: path.join(outDir, `task-center-${label}-${locale}.png`) })
    evidence.observations[locale] = await observe(panel)
    // 展开「制作详情」：阶段名与「已加载技能」是同一类泄漏的另两个出口（阶段 id / 流程身份原样上屏）。
    const card = panel.locator('[data-production-task-card]')
    await clickOrFail(card.locator('details > summary'), '制作详情')
    await screenshotSettled(card, { path: path.join(outDir, `task-center-${label}-${locale}-details.png`) })
    evidence.observations[locale].details = (await card.locator('details').innerText()).replace(/\s+/g, ' ').trim()
    await clickOrFail(card.locator('details > summary'), '收起制作详情')
    if (locale === 'zh') await closeTaskPanel(win)
  }
  // ── 断言：三件事，逐条 ────────────────────────────────────────────────────────────
  for (const [locale, seen] of Object.entries(evidence.observations)) {
    // ① 不露内部代号（含展开后的制作详情：阶段名走翻译，不是注册表里的英文标题）。
    expect(seen.panel, `[${locale}] 任务面板里不该出现内部代号`).not.toMatch(INTERNAL_CODE)
    expect(seen.details, `[${locale}] 制作详情里不该出现内部代号`).not.toMatch(INTERNAL_CODE)
    if (locale === 'zh') expect(seen.details, '[zh] 阶段名应是中文').not.toMatch(/\b(?:Generate|QA|Assemble|Export)\b/)
    // ② 等待超时（可重新拉取）的两行不在「已完成」组；卡上的状态词 = 它所在分组的名字。
    const recoverable = seen.rows.filter((row) => /小鹿|老陈/.test(row.text))
    expect(recoverable.length, `[${locale}] 小鹿、老陈两行都在`).toBe(2)
    for (const row of recoverable) {
      expect(row.group, `[${locale}] 「${row.text}」不该在已完成组`).toBe('attention')
      // 「等你处理」必须把在等的动作摆出来：行上看得见「重新拉取」，不是 hover、不用点进画布。
      expect(row.action, `[${locale}] 「${row.text}」行上应有可见的重新拉取按钮`).toBe('recover_generation')
    }
    expect(seen.cards.length, `[${locale}] 在跑的那份制作有一张卡`).toBe(1)
    const [card] = seen.cards
    const section = seen.sections.find((item) => item.group === card.group)
    expect(section, `[${locale}] 卡片落在某个分组下`).toBeTruthy()
    expect(section.text.startsWith(card.chip), `[${locale}] 卡片状态词「${card.chip}」应等于它所在分组「${section.text}」`).toBe(true)
    expect(card.group, `[${locale}] 供应商慢 ≠ 等你确认：Nomi 还在查，这份制作仍是进行中`).toBe('running')
  }
  // ③ 没提交的 Agent 草稿不成行（先证探针看得见制作条目，再断言草稿行不在）。
  const panel = win.locator(PANEL)
  const proof = await proveProbe(panel.locator('[data-production-task-card]'), '面板里看得见制作条目（卡）')
  await expectAbsent(panel.locator('[data-task-id^="production-run:"]'), {
    provenBy: proof, message: '两份没提交的 Agent 草稿不该在任务面板成行',
  })
  console.log(`✅ task-center-states (${label}) —— 证据：${path.relative(repoRoot, outDir)}`)
} catch (error) {
  process.exitCode = 1
  console.error(`❌ task-center-states (${label})：${error instanceof Error ? error.message : String(error)}`)
} finally {
  // 红绿都落证据：NOMI_EVIDENCE_LABEL=before 的红就是复现数据。
  fs.writeFileSync(path.join(outDir, `task-center-${label}.json`), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  await app?.close()
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
