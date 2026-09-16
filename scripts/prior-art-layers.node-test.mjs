// 「先查别人」分层判据的测试（R17：加规则必须先证明它会红）。
// 两层假仓库：① Map<路径, 正文> 直接喂判据；② 临时 git 仓库里真跑 check-prior-art.mjs（含 PR 侧 diff 信号）。
// 报告案例是 2026-09-17 剪辑方案的「先查别人」节原样结构：8 条出处、只查了整产品与界面两端——旧判据放行，新判据必须红。
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  LAYER_TABLE_THRESHOLD_DATE,
  REQUIRED_LAYERS,
  addedRuntimeDependencies,
  isTestPath,
} from './prior-art-layers-lib.mjs'
import { evaluatePlans, evaluatePullRequestLayers, inspectPlan } from './prior-art-lib.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))

/** 报告案例：两端都查了、中间层一层没查。出处条数远超 3。 */
const EDITING_UPLIFT_SECTION = `# 剪辑能力补齐方案

## 先查别人

- **ChatCut 桌面版（一手）**：60 个 MCP 工具，https://chatcut.io/docs
- **ChatCut 官方文档**：[Agent Plugin](https://chatcut.io/docs/agent-plugin)
- **OpenChatCut（AGPL，只借形状）**：[仓库](https://github.com/0xsline/OpenChatCut)
- **FireRed-OpenStoryline**：[仓库](https://github.com/FireRedTeam/FireRed-OpenStoryline)
- **browser-use/video-use（MIT）**：[仓库](https://github.com/browser-use/video-use)
- **组件库 19 家**：界面层最佳候选是 FreeCut（MIT），https://github.com/example/freecut
- **反方意见**：Remotion 超过 3 人收费，[License FAQ](https://www.remotion.dev/docs/license/faq)
- **仓库已有**：electron/timeline/kernel.ts:12 内核应为唯一写入 owner

## 3. 目标
`

const layerTable = (rows) => `| 层 | 现成候选（标准/引擎/算法）| 许可 | 抄/改/自己写 |\n|---|---|---|---|\n${rows.join('\n')}\n`

const GOOD_ROWS = [
  '| 数据模型（时间轴） | OpenTimelineIO https://github.com/AcademySoftwareFoundation/OpenTimelineIO | Apache-2.0 | 抄 |',
  '| 操作与算法 | OTIO editAlgorithm src/opentimelineio/algo/editAlgorithm.h:40 | Apache-2.0 | 改 |',
  '| 引擎与运行时 | MLT https://github.com/mltframework/mlt | LGPL-2.1 | 自己写 |',
  '| 格式与协议 | 查过：无（https://github.com/search?q=timeline+interchange） | — | 自己写 |',
  '| 对外接口 | 不涉及（本方案不改 MCP 工具面） | — | 不涉及 |',
  '| 界面 | FreeCut https://github.com/example/freecut | MIT | 改（只拿时间轴组件） |',
]

const planWith = (sectionBody) => `# 方案\n\n## 先查别人\n\n- 依赖 https://example.com/a\n- 仓库 https://example.com/b\n- 生态 https://example.com/c\n\n${sectionBody}\n## 范围\n`
const GOVERNED = `docs/plan/${LAYER_TABLE_THRESHOLD_DATE}-x.md`

test('报告案例：8 条出处、中间层没查的剪辑方案 → 红（缺分层表）', () => {
  const errors = evaluatePlans({ plans: new Map([['docs/plan/2026-09-17-editing-uplift-vs-chatcut.md', EDITING_UPLIFT_SECTION]]) })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /缺分层表/)
  for (const layer of REQUIRED_LAYERS) assert.match(errors[0], new RegExp(layer.label))
})

test('合格分层表 → 绿，且 PR 侧状态为 layered', () => {
  const markdown = planWith(layerTable(GOOD_ROWS))
  assert.deepEqual(evaluatePlans({ plans: new Map([[GOVERNED, markdown]]) }), [])
  assert.equal(inspectPlan(GOVERNED, markdown).layer, 'layered')
})

test('老方案（阈值前 / 无日期前缀）没有分层表 → 不追溯，保持绿', () => {
  const plans = new Map([
    ['docs/plan/2026-09-16-old.md', EDITING_UPLIFT_SECTION],
    ['docs/plan/agent-foundation.md', '# 更老\n没有那一节\n'],
  ])
  assert.deepEqual(evaluatePlans({ plans }), [])
  assert.equal(inspectPlan('docs/plan/2026-09-16-old.md', EDITING_UPLIFT_SECTION).layer, 'exempt')
})

test('缺层 → 红，并点名缺的是哪几层', () => {
  const errors = evaluatePlans({ plans: new Map([[GOVERNED, planWith(layerTable(GOOD_ROWS.filter((row) => !/数据模型|引擎/.test(row))))]]) })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /缺层：数据模型.*引擎与运行时/)
})

test('逐行判据：无出处 / 许可空 / 查过无不带链接 / 查过无却写抄 / 不涉及没理由 / 结论不在枚举 → 各自红', () => {
  const cases = [
    ['| 数据模型 | 自己想的模型 | MIT | 抄 |', /现成候选没有出处/],
    ['| 数据模型 | OTIO https://example.com/otio | 待查 | 抄 |', /许可没写/],
    ['| 数据模型 | 查过：无（GitHub 搜了一圈） | — | 自己写 |', /括号里没有出处/],
    ['| 数据模型 | 查过：无（https://github.com/search?q=x） | — | 抄 |', /结论只能是「自己写」/],
    ['| 数据模型 | 查过了，没有 | — | 自己写 |', /查过：无（查了哪里/],
    ['| 数据模型 | 不涉及（） | — | 不涉及 |', /没写理由/],
    ['| 数据模型 | 不涉及（不改状态） | — | 自己写 |', /反之亦然/],
    ['| 数据模型 | OTIO https://example.com/otio | Apache-2.0 | 参考 |', /只能是 抄 \/ 改 \/ 自己写 \/ 不涉及/],
    ['| 数据模型 | OTIO https://example.com/otio | Apache-2.0 | 抄改 |', /只能是 抄 \/ 改 \/ 自己写 \/ 不涉及/],
  ]
  for (const [row, pattern] of cases) {
    const rows = [row, ...GOOD_ROWS.filter((line) => !line.startsWith('| 数据模型'))]
    const errors = evaluatePlans({ plans: new Map([[GOVERNED, planWith(layerTable(rows))]]) })
    assert.ok(errors.some((error) => pattern.test(error)), `${row} 应该红在 ${pattern}，实际：${errors.join(' ‖ ')}`)
  }
})

test('出处第三种（仓库里真实存在的文件）在表格里同样算数', () => {
  const rows = GOOD_ROWS.map((row) => row.startsWith('| 界面') ? '| 界面 | 组件库调研 [报告](../research/c.md) | MIT | 改 |' : row)
  const plans = new Map([[GOVERNED, planWith(layerTable(rows))]])
  assert.deepEqual(evaluatePlans({ plans, fileExists: (file) => file === 'docs/research/c.md' }), [])
  assert.match(evaluatePlans({ plans, fileExists: () => false }).join('\n'), /「界面」行的现成候选没有出处/)
})

test('豁免：封闭枚举 + 理由 → 绿；类别不在枚举 / 没理由 / 与表并存 → 红', () => {
  const ok = planWith('分层查：不适用（类别：修复）—— 只改一个空指针，不碰任何层取舍\n')
  assert.deepEqual(evaluatePlans({ plans: new Map([[GOVERNED, ok]]) }), [])
  assert.equal(inspectPlan(GOVERNED, ok).layer, 'opted-out')

  const arch = planWith('分层查：不适用（类别：架构）—— 太大了\n')
  assert.match(evaluatePlans({ plans: new Map([[GOVERNED, arch]]) })[0], /不在枚举里/)
  const bare = planWith('分层查：不适用（类别：修复）\n')
  assert.match(evaluatePlans({ plans: new Map([[GOVERNED, bare]]) })[0], /没写理由/)
  const both = planWith(`分层查：不适用（类别：修复）—— x\n\n${layerTable(GOOD_ROWS)}`)
  assert.match(evaluatePlans({ plans: new Map([[GOVERNED, both]]) })[0], /二选一/)
})

test('围栏代码块里的「## 先查别人」与示例表不算数：样例骗不过门岗，真节也不会被样例遮住', () => {
  const sample = `# 方案\n\n## 规则形状\n\n\`\`\`markdown\n## 先查别人\n${layerTable(GOOD_ROWS)}\`\`\`\n\n## 范围\n`
  assert.match(evaluatePlans({ plans: new Map([[GOVERNED, sample]]) })[0], /缺少「## 先查别人」一节/)
  const real = `# 方案\n\n\`\`\`markdown\n## 先查别人\n| 层 | 现成候选 | 许可 | 抄 |\n\`\`\`\n\n${planWith(layerTable(GOOD_ROWS))}`
  assert.deepEqual(evaluatePlans({ plans: new Map([[GOVERNED, real]]) }), [])
})

test('缺整节时只报一条「缺节」，不叠报分层表', () => {
  const errors = evaluatePlans({ plans: new Map([[GOVERNED, '# 方案\n## 范围\n']]) })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /缺少「## 先查别人」一节/)
})

test('PR 侧反查：diff 在长新层时，豁免与老方案都不算，带表的才算', () => {
  const plans = new Map([
    [GOVERNED, planWith(layerTable(GOOD_ROWS))],
    ['docs/plan/2026-09-17-fix.md', planWith('分层查：不适用（类别：修复）—— 小修\n')],
    ['docs/plan/2026-09-10-old.md', EDITING_UPLIFT_SECTION],
    ['docs/plan/2026-09-10-old-backfilled.md', planWith(layerTable(GOOD_ROWS))],
  ])
  const run = (body, signals) => evaluatePullRequestLayers({ body, plans, ...signals })
  const big = { newModuleLines: 301, addedDependencies: [] }
  const dep = { newModuleLines: 0, addedDependencies: ['mlt-bindings'] }

  assert.match(run('见 docs/plan/2026-09-17-fix.md', big)[0], /新增文件 301 行.*opted-out/s)
  assert.match(run('见 docs/plan/2026-09-10-old.md', dep)[0], /新增运行时依赖 mlt-bindings.*exempt/s)
  assert.match(run('顺手改', dep)[0], /没有引用任何 docs\/plan/)
  assert.deepEqual(run(`见 ${GOVERNED}`, big), [])
  assert.deepEqual(run('见 docs/plan/2026-09-10-old-backfilled.md', dep), [], '老方案补上分层表就算')
  assert.deepEqual(run('见 docs/plan/2026-09-17-fix.md', { newModuleLines: 300, addedDependencies: [] }), [], '没长新层时豁免照常有效')
})

test('diff 信号的纯函数：新增运行时依赖只看 dependencies；测试文件不算新模块', () => {
  const base = JSON.stringify({ dependencies: { react: '18' }, devDependencies: {} })
  const head = JSON.stringify({ dependencies: { react: '18', zod: '4', ajv: '8' }, devDependencies: { vitest: '4' } })
  assert.deepEqual(addedRuntimeDependencies(base, head), ['ajv', 'zod'])
  assert.deepEqual(addedRuntimeDependencies('', head), ['ajv', 'react', 'zod'], 'base 没有 package.json = 全是新增')
  assert.equal(isTestPath('src/a/b.test.ts'), true)
  assert.equal(isTestPath('electron/x/__tests__/y.ts'), true)
  assert.equal(isTestPath('electron/video/transcribe.ts'), false)
})

// —— 假仓库端到端：真跑 check-prior-art.mjs，含 git diff 取信号与 pull_request 事件 ——
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prior-art-layers-'))
  fs.mkdirSync(path.join(root, 'scripts'))
  for (const file of ['check-prior-art.mjs', 'prior-art-lib.mjs', 'prior-art-layers-lib.mjs']) {
    fs.copyFileSync(path.join(here, file), path.join(root, 'scripts', file))
  }
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), text)
  }
  git('init', '-q')
  git('config', 'user.email', 't@example.com')
  git('config', 'user.name', 't')
  write('package.json', JSON.stringify({ dependencies: { react: '18' } }))
  write('docs/plan/2026-09-01-ancient.md', '# 老方案，没有任何节\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  const base = git('rev-parse', 'HEAD')
  const run = (env = {}) => spawnSync(process.execPath, ['scripts/check-prior-art.mjs'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_EVENT_NAME: '', PRIOR_ART_BASE_REF: base, ...env },
  })
  return { root, write, git, run }
}

test('假仓库：新方案缺分层表 → 退出 1；补上表 → 退出 0；老方案全程不追溯', (t) => {
  const repo = makeRepo()
  t.after(() => fs.rmSync(repo.root, { recursive: true, force: true }))
  repo.write('docs/plan/2026-09-17-editing-uplift-vs-chatcut.md', EDITING_UPLIFT_SECTION)
  const red = repo.run()
  assert.equal(red.status, 1, red.stdout + red.stderr)
  assert.match(red.stderr, /缺分层表/)
  assert.doesNotMatch(red.stderr, /ancient/)

  repo.write('docs/plan/2026-09-17-editing-uplift-vs-chatcut.md', planWith(layerTable(GOOD_ROWS)))
  const green = repo.run()
  assert.equal(green.status, 0, green.stdout + green.stderr)
})

test('假仓库 PR 事件：豁免方案撑一个新模块 → 退出 1；换成带表方案 → 退出 0', (t) => {
  const repo = makeRepo()
  t.after(() => fs.rmSync(repo.root, { recursive: true, force: true }))
  repo.write('docs/plan/2026-09-17-fix.md', planWith('分层查：不适用（类别：修复）—— 声称只是小修\n'))
  repo.write('docs/plan/2026-09-17-layered.md', planWith(layerTable(GOOD_ROWS)))
  repo.write('electron/video/transcribe.ts', `${'export const x = 1\n'.repeat(320)}`)
  repo.write('electron/video/transcribe.test.ts', `${'// test\n'.repeat(500)}`)
  repo.git('add', '-A')
  repo.git('commit', '-q', '-m', 'new module')

  const pr = { GITHUB_EVENT_NAME: 'pull_request' }
  const red = repo.run({ ...pr, PRIOR_ART_PR_BODY: '见 docs/plan/2026-09-17-fix.md' })
  assert.equal(red.status, 1, red.stdout + red.stderr)
  assert.match(red.stderr, /新增文件 320 行/, '测试文件的 500 行不计入')
  assert.match(red.stderr, /opted-out/)

  const green = repo.run({ ...pr, PRIOR_ART_PR_BODY: '见 docs/plan/2026-09-17-layered.md' })
  assert.equal(green.status, 0, green.stdout + green.stderr)
  assert.match(green.stdout, /分层查豁免 1 份：docs\/plan\/2026-09-17-fix\.md/)
})
