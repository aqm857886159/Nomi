// dead-aria-label 规则的判定逻辑单测（R17：加规则先验它会红）。
//
// 为什么必须有这份：规则的第一版**永远报不出东西**——词典里一大票纯占位值（`{{title}}`、`{{model}}`）
// 的通配模式是 `^.+$`，什么 label 都能"拼出来"，于是 322 个字面量全判活、0 命中。装上了、绿着、
// 什么也没测。下面第 4 组就是钉住那个坑的阳性对照。
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  collectAriaLabelLiterals,
  extractInterpolatedValues,
  isAriaLabelAlive,
  templateCanProduce,
} from './lib/ariaLabelLiterals.mjs'
import { findPositionalProjectOpens } from './lib/positionalProjectOpen.mjs'
import { findDeadDataAttributes } from './lib/deadDataAttributes.mjs'
import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanupTestTemp, makeTempDir } from './_test-temp.mjs'
import { judgeBaselineGrowth, judgeBaseUnavailable } from './lib/walkthroughBaselineGuard.mjs'
import { findRawShellAnchors, RAW_SHELL_EXEMPT } from './lib/rawShellAnchors.mjs'
import { findComposerInputReads } from './lib/composerInputReads.mjs'

const SRC = `
  const a = <button aria-label="打开设置" />
  const t = { addNode: '添加{{kind}}节点', bare: '{{title}}', count: '+{{count}}' }
`
const TEMPLATES = extractInterpolatedValues(SRC)

function deadIn(code, { srcText = SRC, templates = TEMPLATES } = {}) {
  return collectAriaLabelLiterals(code)
    .filter(({ literal }) => !isAriaLabelAlive(literal, { srcText, templates }))
    .map(({ literal }) => literal)
}

describe('dead-aria-label：字面量采集', () => {
  it('阳性对照：src 里零命中的 aria-label 被报出来', () => {
    assert.deepEqual(deadIn(`await win.locator('[aria-label="早就没人渲染了"]').click()`), ['早就没人渲染了'])
  })

  it('src 里还有渲染者的不报', () => {
    assert.deepEqual(deadIn(`win.locator('[aria-label="打开设置"]')`), [])
  })

  it('模板拼出来的 label 不报（添加{{kind}}节点 → 添加视频节点）', () => {
    assert.deepEqual(deadIn(`win.locator('[aria-label="添加视频节点"]')`), [])
  })

  // ↓ 这条是整条规则的成败：没有它，规则装上去等于没装。
  it('纯占位模板不得把任意 label 判活（否则规则永远报不出东西）', () => {
    assert.equal(templateCanProduce('{{title}}', '随便什么标签'), false)
    assert.equal(templateCanProduce('+{{count}}', '随便什么标签'), false)
    assert.deepEqual(deadIn(`win.locator('[aria-label="随便什么标签"]')`), ['随便什么标签'])
  })

  it('有锚的模板照常生效', () => {
    assert.equal(templateCanProduce('添加{{kind}}节点', '添加视频节点'), true)
    assert.equal(templateCanProduce('添加{{kind}}节点', '删除视频节点'), false)
  })

  it('走查自己种的数据不报（同名串在选择器之外也出现）', () => {
    const code = `
      const node = { title: '雨夜入场' }
      win.locator('[aria-label*="雨夜入场"]')
    `
    assert.deepEqual(deadIn(code), [])
  })

  it('插值拼出来的选择器跳过（静态判不了）', () => {
    assert.deepEqual(collectAriaLabelLiterals('win.locator(`[aria-label="添加${kind}节点"]`)'), [])
  })

  it('*= ^= $= 三种匹配写法都采到', () => {
    const code = `
      win.locator('[aria-label*="甲甲甲"]')
      win.locator('[aria-label^="乙乙乙"]')
      win.locator('[aria-label$="丙丙丙"]')
    `
    assert.deepEqual(deadIn(code).sort(), ['丙丙丙', '乙乙乙', '甲甲甲'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// positional-project-open：「多项目 × 位置式项目卡选择」（2026-09-06，R17 先验它会红）
//
// 起因：production-mcp 旅程重启后用 `.first()` 点项目卡。自 2026-09-04 起同一隔离库里有两个项目，
// 排序按「最近用过」派生，两者 updatedAt 同秒 → `.first()` 掷硬币 → 一半概率进错项目，
// 任务中心开出来是空的，而报错落在下游的「[data-production-task-card] 10s 超时」。
// 这条规则要在**写下那一行的 commit** 上就红，而不是等 CI 掷到反面。
// ─────────────────────────────────────────────────────────────────────────────
describe('positional-project-open：多项目下的位置式选择', () => {
  const MULTI = `await callTool('nomi_project_create', { name: 'fixture' })`

  it('阳性对照：建了第二个项目又按位置点卡 → 报出来', () => {
    const code = `${MULTI}\nawait win.locator('[data-project-card="true"]').first().click()`
    const hits = findPositionalProjectOpens(code)
    assert.equal(hits.length, 1)
    assert.equal(hits[0].line, 2)
  })

  it('单项目走查的 .first() 不报（位置即身份，不误伤）', () => {
    const code = `await win.locator('[data-project-card]').first().click()`
    assert.deepEqual(findPositionalProjectOpens(code), [])
  })

  it('按身份选中的写法不报：data-project-id', () => {
    const code = `${MULTI}\nawait win.locator('[data-project-card="true"][data-project-id="p1"]').click()`
    assert.deepEqual(findPositionalProjectOpens(code), [])
  })

  it('按身份选中的写法不报：hasText / filter', () => {
    const byText = `${MULTI}\nconst c = win.locator('[data-project-card]', { hasText: name }).first()`
    const byFilter = `${MULTI}\nconst c = win.locator('[data-project-card="true"]').filter({ hasText: name }).first()`
    assert.deepEqual(findPositionalProjectOpens(byText), [])
    assert.deepEqual(findPositionalProjectOpens(byFilter), [])
  })

  it('.nth()/.last() 同属位置式，一并抓', () => {
    const code = `${MULTI}\nwin.locator('[data-project-card]').nth(1)\nwin.locator('[data-project-card]').last()`
    assert.equal(findPositionalProjectOpens(code).length, 2)
  })
})

// dead-data-attr（2026-10-08 外壳重设计：删组件时 data 属性锚点在十几份走查里悬空，前两条规则都看不见）。
describe('dead-data-attr：data 属性锚点存活', () => {
  const SRC_ATTRS = `
    <button data-agent-ball={status} data-v4-control="history" />
    <div data-clip-id={clip.id} />
    el.dataset.timelineStrip = ''
  `
  const dead = (code) => findDeadDataAttributes(code, SRC_ATTRS).map((hit) => hit.text)

  it('阳性对照：src 里零命中的属性名被报出来', () => {
    assert.deepEqual(dead(`win.locator('[data-agent-topbar-badge="true"]')`), ['[data-agent-topbar-badge="true"]'])
  })

  it('阳性对照：属性还在、但写死的枚举值已无人渲染 → 报出来', () => {
    assert.deepEqual(dead(`document.querySelector('[data-v4-control="dock-open"]')`), ['[data-v4-control="dock-open"]'])
  })

  it('活着的属性名 / 枚举值不报', () => {
    assert.deepEqual(dead(`win.locator('[data-agent-ball]'); win.locator('[data-v4-control="history"]')`), [])
  })

  it('数据驱动的值（src 里没写死过字面量值）不判值', () => {
    assert.deepEqual(dead(`win.locator('[data-clip-id="clip-a"]')`), [])
  })

  it('dataset.camelCase 写法算活', () => {
    assert.deepEqual(dead(`win.locator('[data-timeline-strip]')`), [])
  })

  it('第三方运行时属性与走查自己 setAttribute 造的标记不报', () => {
    assert.deepEqual(dead(`win.locator('[data-highlighted]'); el.setAttribute('data-walk-mark', '1'); win.locator('[data-walk-mark]')`), [])
  })
})

describe('dead-data-attr：判活口径的三处精度（#1136 复核）', () => {
  const SRC_DYNAMIC = `
    <div data-v4-control="history" />
    rowAttributes={(row) => ({ 'data-v4-command': row.id })}
    <a data-v4-command="literal" />
  `
  const dead = (code) => findDeadDataAttributes(code, SRC_DYNAMIC).map((hit) => hit.text)

  it('对象键写成表达式的属性（数据驱动的值）不判值', () => {
    assert.deepEqual(dead(`win.locator('[data-v4-command="skill:x"]')`), [])
  })

  it('expectAbsent 里的锚点是「删了不许回来」的防复发断言，不算悬空', () => {
    assert.deepEqual(dead(`await expectAbsent(win.locator('[data-gone-forever]'), { provenBy: p })`), [])
  })

  it('同一个锚点不在 expectAbsent 里照样报（其它写法的「不存在」要换成带基线的 expectAbsent）', () => {
    assert.deepEqual(dead(`check(document.querySelectorAll('[data-gone-forever]').length === 0)`), ['[data-gone-forever]'])
  })
})

describe('走查基线只减不增（#1136 评审阻断 2）', () => {
  const ids = ['dead-selector', 'dead-data-attr']

  it('阳性对照：已有规则的基线被上调 → 报', () => {
    const errors = judgeBaselineGrowth({ ruleIds: ids, baseline: { 'dead-selector': 3 }, baseBaseline: { 'dead-selector': 1 } })
    assert.equal(errors.length, 1)
  })

  it('阳性对照：新规则首发基线高于 merge-base 实测 → 报（不能「把当前数写进去」放宽）', () => {
    const errors = judgeBaselineGrowth({ ruleIds: ids, baseline: { 'dead-data-attr': 97 }, baseBaseline: {}, measureOnBase: () => 56 })
    assert.equal(errors.length, 1)
  })

  it('新规则量不了 merge-base 上的数时，首发基线只能是 0', () => {
    assert.equal(judgeBaselineGrowth({ ruleIds: ids, baseline: { 'dead-data-attr': 1 }, baseBaseline: {} }).length, 1)
    assert.deepEqual(judgeBaselineGrowth({ ruleIds: ids, baseline: { 'dead-data-attr': 0 }, baseBaseline: {} }), [])
  })

  it('首发基线等于 merge-base 实测、已有规则只降不升 → 不报', () => {
    assert.deepEqual(judgeBaselineGrowth({ ruleIds: ids, baseline: { 'dead-selector': 0, 'dead-data-attr': 56 }, baseBaseline: { 'dead-selector': 1 }, measureOnBase: () => 56 }), [])
  })
})

describe('merge-base 拿不到时 fail-closed（#1136 复审阻断）', () => {
  const rules = [{ id: 'dead-selector', measurable: false }, { id: 'dead-data-attr', measurable: true }]

  it('有 merge-base 实测能力的规则基线非零 → 红；基线为 0 或没有实测能力的规则 → 不拦', () => {
    assert.equal(judgeBaseUnavailable({ rules, baseline: { 'dead-selector': 5, 'dead-data-attr': 97 } }).length, 1)
    assert.deepEqual(judgeBaseUnavailable({ rules, baseline: { 'dead-selector': 5, 'dead-data-attr': 0 } }), [])
  })

  it('集成：真实脚本在没有 origin/main 的仓库里跑，必须红（旧行为是 warning + exit 0）', () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const emptyGitDir = makeTempDir('nomi-no-origin-')
    try {
      execFileSync('git', ['init', '-q', '--bare', emptyGitDir], { stdio: 'ignore' })
      // GIT_DIR 指向一个空仓库：merge-base / show 全部失败，等价于「浅克隆 / 没有 origin/main」；脚本读的是工作区文件，不受影响。
      const run = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'check-walkthroughs.mjs')], {
        cwd: repoRoot,
        env: { ...process.env, GIT_DIR: emptyGitDir },
        encoding: 'utf8',
      })
      assert.notEqual(run.status, 0, run.stdout + run.stderr)
      assert.match(run.stderr, /走查基线无法核对/)
    } finally {
      cleanupTestTemp(emptyGitDir)
    }
  })
})

describe('raw-shell-anchor：外壳位置只准经 _shell.mjs（#1136 CI 全红的类根因）', () => {
  it('阳性对照：手抄「返回项目库」钮 / 面板收起展开钮 / 面板身份选择器都报', () => {
    assert.equal(findRawShellAnchors(`await clickOrFail(win.getByRole('button', { name: '返回项目库', exact: true }), 'x')`).length, 1)
    assert.equal(findRawShellAnchors(`await page.getByRole('button', { name: /返回项目库|Back to projects/ }).first().click()`).length, 1)
    assert.equal(findRawShellAnchors(`await win.locator('[data-v4-control="collapse"]').first().click()`).length, 1)
    assert.equal(findRawShellAnchors(`document.querySelector('[data-v4-control="dock-open"]')?.click()`).length, 1)
    assert.equal(findRawShellAnchors(`const P = '[data-agent-resident="true"][data-agent-panel="true"]'`).length, 1)
    assert.equal(findRawShellAnchors(`win.locator('[data-agent-resident="true"][data-agent-collapsed="true"]')`).length, 1)
    assert.equal(findRawShellAnchors(`win.locator('[data-testid="open-model-settings"]').first()`).length, 1)
    assert.equal(findRawShellAnchors(`win.locator('[aria-label="打开模型设置"]')`).length, 1)
    assert.equal(findRawShellAnchors(`await clickOrFail(win.getByRole('button', { name: /^新建空白项目/ }), 'x')`).length, 1)
    assert.equal(findRawShellAnchors(`win.locator('button, [role="button"]', { hasText: '新建空白项目' }).first()`).length, 1)
    assert.equal(findRawShellAnchors(`win.getByText('新建空白项目', { exact: false }).first().click()`).length, 1)
    // 画布底部（2026-10-10）：加节点条 / 缩放簇的选择器与控件名
    assert.equal(findRawShellAnchors(`win.locator('.generation-canvas-v2-toolbar [data-add-intent="image"]')`).length, 1)
    assert.equal(findRawShellAnchors(`win.locator('.generation-canvas-v2__zoom-bar button').first()`).length, 1)
    assert.equal(findRawShellAnchors(`document.querySelector('.generation-canvas-v2__navigation-stack')`).length, 1)
    assert.equal(findRawShellAnchors(`win.getByRole('button', { name: '适应视图', exact: true })`).length, 1)
    assert.equal(findRawShellAnchors(`win.getByRole('slider', { name: '缩放比例' })`).length, 1)
    assert.equal(findRawShellAnchors(`page.locator('button[aria-label="重置视图"]')`).length, 1)
    assert.equal(findRawShellAnchors(`win.getByRole('button', { name: '打开模型设置', exact: true })`).length, 1)
  })

  it('经出口函数 / 在断言文案里提到「返回项目库」都不报', () => {
    assert.deepEqual(findRawShellAnchors(`await backToLibrary(win)`), [])
    assert.deepEqual(findRawShellAnchors(`await expectVisible(entry, '没有返回项目库')`), [])
    assert.deepEqual(findRawShellAnchors(`await ensureAgentPanelOpen(win)`), [])
    assert.deepEqual(findRawShellAnchors(`await newProjectEntry(win).click()`), [])
    assert.deepEqual(findRawShellAnchors(`await canvasAddBar(win).locator('[data-add-intent="image"]').click()`), [])
    assert.deepEqual(findRawShellAnchors(`win.locator('.generation-canvas-v2-toolbar__node-menu')`), [])
    assert.deepEqual(findRawShellAnchors(`await openModelSettings(win, { label: '连接模型入口' })`), [])
  })

  it('夜跑分诊（10-15）：旧侧栏 / 按库全名找导轨钮 / 旧收起按钮名 / 旧语言控件 / 工作区容器按文字找，都抓', () => {
    assert.ok(findRawShellAnchors(`win.locator('aside nav button[aria-label="素材库"]').first()`).length >= 1)
    assert.equal(findRawShellAnchors(`await win.getByRole('button', { name: '技能库', exact: true }).first().click()`).length, 1)
    assert.equal(findRawShellAnchors(`page.getByRole('button', { name: 'Prompt library', exact: true })`).length, 1)
    assert.equal(findRawShellAnchors(`getWin().locator('button[aria-label="Workflow library"]').first()`).length, 1)
    assert.equal(findRawShellAnchors(`await win.getByRole('button', { name: '收起面板', exact: true }).click()`).length, 1)
    assert.equal(findRawShellAnchors(`win.getByRole('button', { name: '展开创作助手' })`).length, 1)
    assert.equal(findRawShellAnchors(`await win.locator('[aria-label="语言"]').first().click()`).length, 1)
    assert.equal(findRawShellAnchors(`await win.locator('[role="menuitemradio"]', { hasText: 'English' }).first().click()`).length, 1)
    assert.equal(findRawShellAnchors(`await win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }).click()`).length, 1)
    assert.equal(findRawShellAnchors(`win.getByRole('navigation', { name: '工作区切换' }).getByRole('button', { name: '生成', exact: true })`).length, 1)
  })

  it('新出口函数 / 抽屉内容区面板名 / 只判容器在不在，都不报', () => {
    assert.deepEqual(findRawShellAnchors(`await openRailDrawer(win, 'assets', '素材库')`), [])
    assert.deepEqual(findRawShellAnchors(`await switchWorkspace(win, 'generation')`), [])
    assert.deepEqual(findRawShellAnchors(`await setAppLanguage(win, 'en')`), [])
    assert.deepEqual(findRawShellAnchors(`await collapseAgentPanel(win)`), [])
    assert.deepEqual(findRawShellAnchors(`win.getByRole('region', { name: '流程库' })`), [])
    assert.deepEqual(findRawShellAnchors(`await win.locator('[aria-label="工作区切换"]').first().waitFor()`), [])
  })

  it('豁免表每一条都写了原因，且出口文件在里面', () => {
    assert.ok(RAW_SHELL_EXEMPT.has('tests/ux/_shell.mjs'))
    for (const [file, reason] of RAW_SHELL_EXEMPT) assert.ok(reason.length >= 6, `${file} 的豁免原因太短`)
  })
})

describe('composer-input-read：Agent 输入框是富文本编辑器，不能当 input 读（#1183 CI 红的类根因）', () => {
  it('直接读 / 经变量读 / 旧 textarea 选择器都抓', () => {
    assert.equal(findComposerInputReads("await expect(panel.locator(COMPOSER_INPUT)).toHaveValue('x')").length, 1)
    assert.equal(findComposerInputReads("const d = await win.locator(`${P} ${COMPOSER_INPUT}`).inputValue()").length, 1)
    assert.equal(findComposerInputReads("const box = canvas.locator(COMPOSER_INPUT)\nawait expect(box, 'm').toHaveValue('x')").length, 1)
    assert.equal(findComposerInputReads("const box = canvas.locator(COMPOSER_INPUT)\nconst v = await box.inputValue()").length, 1)
    assert.equal(findComposerInputReads("win.locator('textarea[data-v4-control=\"input\"]').fill('x')").length, 1)
  })
  it('统一出口、写字、别的输入框不误伤', () => {
    assert.deepEqual(findComposerInputReads("await expectComposerText(panel.locator(COMPOSER_INPUT), 'x', 'm')"), [])
    assert.deepEqual(findComposerInputReads("await panel.locator(COMPOSER_INPUT).fill('x')"), [])
    assert.deepEqual(findComposerInputReads("const search = win.locator('#q')\nawait expect(search).toHaveValue('x')"), [])
  })
  it('方法链换行写的读法也认：主语和读法分在两行，报首行行号（以前单行判定会对不上）', () => {
    const chained = "await expect(panel.locator(COMPOSER_INPUT), 'm')\n  .toHaveValue('x')"
    assert.deepEqual(findComposerInputReads(chained).map((hit) => hit.line), [1])
    assert.equal(findComposerInputReads("const v = await panel.locator(COMPOSER_INPUT)\n  .inputValue()").length, 1)
  })
})

describe('composer-input-read：占位也不能按 placeholder 属性读（短片走查自 10-12 起每晚红在这，只在夜跑里红、没人在 PR 里看见）', () => {
  it('夜跑红的原形：断言 Agent 输入框的 placeholder 属性', () => {
    const original = "await expect(canvas.locator(COMPOSER_INPUT)).toHaveAttribute('placeholder', /排队/)"
    const hits = findComposerInputReads(original)
    assert.equal(hits.length, 1)
    assert.match(hits[0].use, /composerPlaceholder|expectComposerPlaceholder/)
  })
  it('各种读法都抓：getAttribute / DOM 属性 / 属性选择器 / getByPlaceholder / 在输入区块里找', () => {
    assert.equal(findComposerInputReads("const hint = await panel.locator(COMPOSER_INPUT).getAttribute('placeholder')").length, 1)
    assert.equal(findComposerInputReads('const hint = await panel.locator(COMPOSER_INPUT).getAttribute("placeholder")').length, 1)
    assert.equal(findComposerInputReads("await win.locator('[data-v4-control=\"input\"]').evaluate((el) => el.placeholder)").length, 1)
    assert.equal(findComposerInputReads("await expect(win.locator('[data-v4-control=\"input\"][placeholder]')).toBeVisible()").length, 1)
    assert.equal(findComposerInputReads("await panel.locator(COMPOSER).getByPlaceholder('x').click()").length, 1)
    assert.equal(findComposerInputReads("await win.locator(`${CANVAS_PANEL} ${COMPOSER}`).locator('[placeholder]').count()").length, 1)
  })
  it('经变量读、方法链换行写，都抓', () => {
    assert.equal(findComposerInputReads("const box = canvas.locator(COMPOSER_INPUT)\nawait expect(box, 'm').toHaveAttribute('placeholder', 'x')").length, 1)
    assert.equal(findComposerInputReads("const box = canvas.locator(COMPOSER_INPUT)\nconst hint = await box.getAttribute('placeholder')").length, 1)
    assert.equal(findComposerInputReads("const box = canvas.locator(COMPOSER_INPUT)\nawait box.evaluate((el) => el.placeholder)").length, 1)
    const chained = "await expect(canvas.locator(COMPOSER_INPUT), 'm')\n  .toHaveAttribute('placeholder', /x/)"
    assert.deepEqual(findComposerInputReads(chained).map((hit) => hit.line), [1])
    const split = "const box = canvas\n  .locator(COMPOSER_INPUT)\nawait expect(box).toHaveAttribute('placeholder', /x/)"
    assert.equal(findComposerInputReads(split).length, 1)
  })
  it('统一出口、别的输入框、别的名字不误伤', () => {
    assert.deepEqual(findComposerInputReads("await expectComposerPlaceholder(canvas.locator(COMPOSER_INPUT), text, 'm')"), [])
    assert.deepEqual(findComposerInputReads('const shown = await composerPlaceholder(panel.locator(COMPOSER_INPUT))'), [])
    // 普通 <input>（项目库搜索框之类）本来就有 placeholder 属性，读它是正当的
    assert.deepEqual(findComposerInputReads("await expect(win.locator('input[type=\"search\"]')).toHaveAttribute('placeholder', /x/)"), [])
    assert.deepEqual(findComposerInputReads("const search = win.locator('#q')\nawait expect(search).toHaveAttribute('placeholder', 'x')"), [])
    // 生成节点自己的生成框（NODE_COMPOSER）、镜头占位状态（face.placeholder）是别的组件
    assert.deepEqual(findComposerInputReads("await win.locator(NODE_COMPOSER).getByPlaceholder('x').click()"), [])
    assert.deepEqual(findComposerInputReads("expect(face.placeholder).toBe('queued')"), [])
    // `...spread` 起头的行不是方法链的续行，不并回上一行
    assert.deepEqual(findComposerInputReads('foo(COMPOSER_INPUT)\n  ...obj.placeholder'), [])
  })
  it('如实：读 data-placeholder 不在这条规则里（它是活的读法，Agent 输入框上全仓 0 处；唯一一处在生成节点的描述框）', () => {
    assert.deepEqual(findComposerInputReads("const node = win.locator('.generation-canvas-v2-node__prompt-input [data-placeholder]')\nawait node.getAttribute('data-placeholder')"), [])
  })
})
