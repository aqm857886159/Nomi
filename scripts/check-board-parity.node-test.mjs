// 设计图对账门岗的必红测试：每条规则一个反例（应红）+ 一个正例（应绿）。
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { BOARD_NAME, BOARD_STATES, checkBoardManifest, checkBoundarySheet, checkPriorArt, checkPrBoardClaims, checkSourceHash, compareBoardManifests, findDatedBoards, loadManifests, makeReferrerScanner, parsePrBoardClaims, runBoardParity } from './check-board-parity.mjs'
import { makeTempDir } from './_test-temp.mjs'
import { BOARD_NAMES } from './board-extract.mjs'
import { hashBoardSourceFiles } from './board-source-hash.mjs'

const CORPUS = "it('board:Main/topbar.title', () => {})"
const candidates = [{ id: '001-text-A' }, { id: '002-icon' }, { id: '003-text-B' }]
const base = () => ({
  board: 'Main',
  stage: 'explored',
  elements: [
    { id: 'topbar.title', label: '标题', candidates: ['001-text-A', '002-icon'], status: 'implemented', assertion: 'board:Main/topbar.title', states: ['zh-en'] },
    { id: 'group.header', label: '分组框头', candidates: ['003-text-B'], status: 'missing', owner: 'I-groupheader', states: ['empty'] },
  ],
  decor: [],
  functionCensus: [{ function: '标题', before: '顶栏标题', after: 'topbar.title' }],
})
const run = (manifest, cands = candidates, corpus = CORPUS) => checkBoardManifest({ board: 'Main', manifest, candidates: cands, assertionCorpus: corpus })

describe('R1 候选恰好被认领一次', () => {
  it('正例：每个候选都有去处', () => assert.deepEqual(run(base()), []))
  it('反例：板上有的候选清单没认领 → 红', () => {
    const m = base()
    m.elements[1].candidates = []
    assert.match(run(m).join('\n'), /候选未认领.*003-text-B/)
  })
  it('反例：同一候选被两个元素认领 → 红', () => {
    const m = base()
    m.elements[1].candidates = ['003-text-B', '001-text-A']
    assert.match(run(m).join('\n'), /重复认领.*001-text-A/)
  })
  it('反例：板改了，清单引用的候选已不存在 → 红', () => {
    assert.match(run(base(), candidates.slice(0, 2)).join('\n'), /不存在的候选：003-text-B/)
  })
  it('正例：纯装饰进 decor 也算认领', () => {
    const m = base()
    m.elements[1].candidates = []
    m.decor = ['003-text-B']
    assert.deepEqual(run(m), [])
  })
})

describe('R2 status 合法、元素 id 唯一、引用存在', () => {
  it('反例：status 写错 → 红', () => {
    const m = base()
    m.elements[0].status = 'done'
    assert.match(run(m).join('\n'), /status 非法：done/)
  })
  it('反例：元素 id 重复 → 红', () => {
    const m = base()
    m.elements[1].id = 'topbar.title'
    assert.match(run(m).join('\n'), /元素 id 重复：topbar.title/)
  })
})

describe('R3 missing / in-progress 必须有 owner', () => {
  it('反例：missing 没写 owner → 红', () => {
    const m = base()
    delete m.elements[1].owner
    assert.match(run(m).join('\n'), /必须写 owner/)
  })
  it('反例：in-progress 没写 owner → 红', () => {
    const m = base()
    m.elements[1].status = 'in-progress'
    delete m.elements[1].owner
    assert.match(run(m).join('\n'), /in-progress，必须写 owner/)
  })
})

describe('R4 implemented 必须有真断言', () => {
  it('反例：implemented 没有 assertion → 红', () => {
    const m = base()
    delete m.elements[0].assertion
    assert.match(run(m).join('\n'), /必须写 assertion/)
  })
  it('反例：断言名在 tests/ux 里找不到（空断言）→ 红', () => {
    const m = base()
    m.elements[0].assertion = 'board:Main/不存在的断言'
    assert.match(run(m).join('\n'), /不在 tests\/ux 任何走查文件里/)
  })
  it('正例：断言名在走查语料里 → 绿', () => assert.deepEqual(run(base()), []))
})

describe('R5 deferred / dropped 必须有用户原话和日期', () => {
  it('反例：deferred 没有 userDecision → 红', () => {
    const m = base()
    m.elements[1].status = 'deferred'
    delete m.elements[1].owner
    assert.match(run(m).join('\n'), /必须有 userDecision/)
  })
  it('反例：dropped 只有原话没有日期 → 红', () => {
    const m = base()
    m.elements[1].status = 'dropped'
    delete m.elements[1].owner
    m.elements[1].userDecision = { quote: '不要了' }
    assert.match(run(m).join('\n'), /必须有 userDecision/)
  })
  it('正例：dropped 有原话和日期 → 绿', () => {
    const m = base()
    m.elements[1].status = 'dropped'
    delete m.elements[1].owner
    m.elements[1].userDecision = { quote: '不要了', date: '2026-10-10' }
    assert.deepEqual(run(m), [])
  })
})

describe('R6 旧功能普查必须有去处', () => {
  it('反例：功能的去处指向不存在的元素 → 红', () => {
    const m = base()
    m.functionCensus = [{ function: '导出', before: '导出按钮', after: 'nowhere' }]
    assert.match(run(m).join('\n'), /旧功能「导出」没有去处/)
  })
  it('正例：去处是本板元素 → 绿', () => assert.deepEqual(run(base()), []))
})

describe('R7 states 非空且来自词表', () => {
  it('反例：states 为空 → 红', () => {
    const m = base()
    m.elements[0].states = []
    assert.match(run(m).join('\n'), /缺 states/)
  })
  it('反例：states 写了词表外的词 → 红', () => {
    const m = base()
    m.elements[0].states = ['看起来还行']
    assert.match(run(m).join('\n'), /不在状态词表里/)
  })
})

describe('R9 priorArt：2026-10-19 起的板必须带 ≥3 项先例（更早的板不追溯）', () => {
  const item = (n) => ({ url: `https://example.com/${n}`, takeaway: '它怎么做', decisionImpact: '改了：底栏位置' })
  const withPrior = (items, date = '2026-10-19') => ({ manifest: { ...base(), priorArt: items }, date })
  const runDated = ({ manifest, date }) => checkBoardManifest({ board: 'Main', manifest, candidates, assertionCorpus: CORPUS, date })
  it('正例：3 项齐全 → 绿', () => assert.deepEqual(runDated(withPrior([item(1), item(2), item(3)])), []))
  it('正例：更早的板（2026-10-18）没有 priorArt → 绿，不追溯', () => assert.deepEqual(runDated({ manifest: base(), date: '2026-10-18' }), []))
  it('反例：2026-10-19 的板缺 priorArt → 红', () => assert.match(runDated({ manifest: base(), date: '2026-10-19' }).join('\n'), /必须有 priorArt/))
  it('反例：只有 2 项 → 红', () => assert.match(runDated(withPrior([item(1), item(2)])).join('\n'), /至少 3 项，现在 2 项/))
  it('反例：缺 decisionImpact（只列链接，没写对决定的影响）→ 红', () => {
    const bare = { url: 'https://example.com/x', takeaway: '它怎么做' }
    assert.match(runDated(withPrior([item(1), item(2), bare])).join('\n'), /priorArt\[2\] 缺 decisionImpact/)
  })
  it('反例：url 不是链接 → 红', () => {
    assert.match(runDated(withPrior([item(1), item(2), { ...item(3), url: '凭记忆' }])).join('\n'), /不是 http\(s\) 链接/)
  })
  it('日期没给就看清单的 approvedOn', () => {
    assert.match(checkPriorArt({ board: 'Main', manifest: { approvedOn: '2026-10-20' } }).join('\n'), /必须有 priorArt/)
    assert.deepEqual(checkPriorArt({ board: 'Main', manifest: { approvedOn: '2026-10-18' } }), [])
  })
  it('真跑：日期目录 ≥ 2026-10-19 的新板缺 priorArt → 门岗红；2026-10-18 目录不红', async () => {
    const root = fs.mkdtempSync(path.join(process.env.TMPDIR || process.env.TEMP || '.', 'bp-prior-'))
    const main = path.join(root, 'main-day'); fs.mkdirSync(main)
    const manifest = JSON.stringify({ board: 'Fresh', stage: 'built', elements: [], decor: [], functionCensus: [] })
    for (const day of ['2026-10-18', '2026-10-19']) {
      fs.mkdirSync(path.join(root, day))
      fs.writeFileSync(path.join(root, day, `${day === '2026-10-18' ? 'Old' : 'Fresh'}.board.json`), manifest.replace('Fresh', day === '2026-10-18' ? 'Old' : 'Fresh'))
    }
    const errors = await runBoardParity({ dir: main, root })
    fs.rmSync(root, { recursive: true, force: true })
    assert.ok(errors.some((e) => /\[Fresh\].*priorArt/.test(e)), errors.join('\n'))
    assert.ok(!errors.some((e) => /\[Old\].*priorArt/.test(e)), errors.join('\n'))
  })
})

describe('R10 boundarySheet：2026-11-13 起的板必须带边界表（更早的板不查，写了照样查）', () => {
  const row = (over = {}) => ({ where: '参考图行', max: '30 张', source: '模型声明的参考上限', layout: '折行，超出在自己区域里滚', board: 'Main', element: 'topbar.title', ...over })
  const names = ['Main']
  const runSheet = (sheet, date = '2026-11-13') => checkBoundarySheet({ board: 'Main', manifest: { ...base(), ...(sheet === undefined ? {} : { boundarySheet: sheet }) }, date, boardNames: names })
  it('正例：完整一行 → 绿', () => assert.deepEqual(runSheet([row()]), []))
  it('正例：{ none: 原因 } → 绿', () => assert.deepEqual(runSheet({ none: '这一屏只有固定的两个按钮' }), []))
  it('正例：状态词表里有 max-count，元素可以用它', () => {
    assert.ok(BOARD_STATES.includes('max-count'))
    const m = base()
    m.elements[0].states = ['max-count']
    assert.deepEqual(run(m), [])
  })
  it('反例：2026-11-13 的板缺 boundarySheet → 红', () => assert.match(runSheet(undefined).join('\n'), /必须有 boundarySheet/))
  it('反例：空数组 → 红', () => assert.match(runSheet([]).join('\n'), /至少 1 行/))
  it('反例：缺字段（六个字段各查一遍）→ 红', () => {
    for (const field of ['where', 'max', 'source', 'layout', 'board', 'element']) {
      assert.match(runSheet([row({ [field]: '  ' })]).join('\n'), new RegExp(`boundarySheet\\[0\\] 缺 ${field}`))
    }
  })
  it('反例：板名不在同目录 → 红', () => assert.match(runSheet([row({ board: 'Nope' })]).join('\n'), /不是同目录里的板名/))
  it('反例：元素 id 不在清单里 → 红', () => assert.match(runSheet([row({ element: 'ghost' })]).join('\n'), /不是本清单的元素 id/))
  it('反例：none 为空 → 红', () => assert.match(runSheet({ none: '' }).join('\n'), /原因不能为空/))
  it('反例：既不是数组也没有 none → 红', () => assert.match(runSheet({}).join('\n'), /原因不能为空/))
  it('日期早（2026-11-12）没有 boundarySheet → 绿，不追溯', () => assert.deepEqual(runSheet(undefined, '2026-11-12'), []))
  it('日期早但写错了照样红', () => assert.match(runSheet([row({ element: 'ghost' })], '2026-11-12').join('\n'), /不是本清单的元素 id/))
  it('反例：目录名带后缀（2026-11-13-mode-bar）照样按开头的日期算 → 红；2026-11-12-mode-bar 不查', () => {
    assert.match(runSheet(undefined, '2026-11-13-mode-bar').join('\n'), /必须有 boundarySheet/)
    assert.deepEqual(runSheet(undefined, '2026-11-12-mode-bar'), [])
  })
  it('日期没给就看清单的 approvedOn', () => {
    assert.match(checkBoundarySheet({ board: 'Main', manifest: { approvedOn: '2026-11-14' }, boardNames: names }).join('\n'), /必须有 boundarySheet/)
    assert.deepEqual(checkBoundarySheet({ board: 'Main', manifest: { approvedOn: '2026-11-12' }, boardNames: names }), [])
  })
  it('真跑：日期目录 2026-11-13 的板缺边界表 → 门岗红；2026-11-12 目录不红', async () => {
    const root = makeTempDir('bp-bsheet-')
    const main = path.join(root, 'main-day'); fs.mkdirSync(main)
    for (const [day, name] of [['2026-11-12', 'Old'], ['2026-11-13', 'Fresh']]) {
      fs.mkdirSync(path.join(root, day))
      const priorArt = [1, 2, 3].map((n) => ({ url: `https://example.com/${n}`, takeaway: 'a', decisionImpact: 'b' }))
      fs.writeFileSync(path.join(root, day, `${name}.board.json`), JSON.stringify({ board: name, stage: 'built', priorArt, elements: [], decor: [], functionCensus: [] }))
    }
    const errors = await runBoardParity({ dir: main, root })
    fs.rmSync(root, { recursive: true, force: true })
    assert.ok(errors.some((e) => /\[Fresh\].*boundarySheet/.test(e)), errors.join('\n'))
    assert.ok(!errors.some((e) => /\[Old\].*boundarySheet/.test(e)), errors.join('\n'))
  })
})

describe('R11–R15：2026-11-15 起的板要带设计流程输入（2026-11-14 用户拍板；更早的板不追溯）', () => {
  const SHA = 'a'.repeat(64)
  const COMPONENT = 'src/design/Thing.tsx'
  const REFERRERS = { [COMPONENT]: ['src/workbench/PanelA.tsx', 'src/devlab/designLab/thing/thingLabKit.tsx'] }
  const referrersOf = (file) => REFERRERS[file] ?? null
  // 假板：每条新检查都齐的一张 11-15 板（只在测试里，不进 docs/design/boards/）
  const full = () => {
    const m = base()
    m.elements[1].states = ['empty', 'max-count']
    m.priorArt = [
      { kind: 'same-surface', product: '同类产品甲', screenshotSha256: SHA, seenOn: '2026-11-14', differences: [{ what: '菜单放在底栏而不是顶栏', why: '创作者的手在底栏' }] },
      { url: 'https://example.com/2', takeaway: '它怎么做', decisionImpact: '确认了：分组' },
      { url: 'https://example.com/3', takeaway: '它怎么做', decisionImpact: '改了：图标' },
    ]
    m.boundarySheet = [{ where: '分组框头', max: '99 组', source: '存储上限', layout: '折行', board: 'Main', element: 'group.header' }]
    m.components = [COMPONENT]
    m.appearsIn = [
      { place: '面板 A', files: ['src/workbench/PanelA.tsx'], board: 'Main', element: 'topbar.title' },
      { place: '设计实验室 thing 屏', files: ['src/devlab/designLab/thing/thingLabKit.tsx'], board: 'Main', element: 'topbar.title' },
    ]
    m.functionCensus = [
      { function: '标题', before: '顶栏标题', after: 'topbar.title', placement: 'direct', ifRemoved: '不知道自己在哪个项目' },
      { function: '导出', before: '顶栏按钮', after: 'group.header', placement: 'menu', frequency: '不知道', peerPlacement: '同类产品甲放在右上角菜单', ifRemoved: '交不了片' },
      { function: '旧开关', before: '顶栏', after: 'group.header', placement: 'dropped' },
    ]
    m.priorDecisions = [{ what: '顶栏只放标题', source: '用户 2026-10-10 拍板', stillValid: '算数' }]
    return m
  }
  const runNew = (manifest, date = '2026-11-15') => checkBoardManifest({ board: 'Main', manifest, candidates, assertionCorpus: CORPUS, date, boardNames: ['Main'], referrersOf })
  const red = (manifest, pattern, date) => assert.match(runNew(manifest, date).join('\n'), pattern)

  it('正例：每条都齐 → 绿', () => assert.deepEqual(runNew(full()), []))
  it('正例：同一张板放在 2026-11-14 目录，新栏全删 → 绿（不追溯）', () => {
    const m = full()
    for (const key of ['components', 'appearsIn', 'priorDecisions']) delete m[key]
    m.priorArt[0] = { url: 'https://example.com/1', takeaway: 'a', decisionImpact: 'b' }
    m.functionCensus = m.functionCensus.map(({ function: fn, before, after }) => ({ function: fn, before, after }))
    m.boundarySheet = { none: '旧板' }
    assert.deepEqual(runNew(m, '2026-11-14'), [])
    assert.deepEqual(runNew(m, '2026-11-14-mode-bar'), [])
  })
  it('目录名带后缀也按开头日期算：2026-11-15-xx 照样查', () => {
    const m = full()
    delete m.priorDecisions
    red(m, /缺 priorDecisions/, '2026-11-15-model-menu')
  })

  // R11
  it('R11 反例：缺同类产品先例（第一项是普通先例）→ 红', () => {
    const m = full()
    m.priorArt[0] = { url: 'https://example.com/1', takeaway: 'a', decisionImpact: 'b' }
    red(m, /priorArt 第一项必须是最接近的成熟同类产品同一处/)
  })
  it('R11 反例：截图指纹不是 sha256 / 没写看的日期 / 差异为空 → 红', () => {
    const m = full()
    Object.assign(m.priorArt[0], { screenshotSha256: 'docs/shot.png', seenOn: '昨天', differences: [] })
    const out = runNew(m).join('\n')
    assert.match(out, /缺 screenshotSha256/)
    assert.match(out, /缺 seenOn/)
    assert.match(out, /缺 differences/)
  })
  it('R11 反例：差异只写了哪里、没写为什么 → 红', () => {
    const m = full()
    m.priorArt[0].differences = [{ what: '颜色不一样' }]
    red(m, /differences\[0\] 缺 why/)
  })
  it('R11 正例：同类产品没有这个东西，写查了哪里 → 绿；absent 为空 → 红', () => {
    const m = full()
    m.priorArt[0] = { kind: 'same-surface', product: '同类产品甲', absent: '它的画布、设置页和帮助文档都没有全景功能' }
    assert.deepEqual(runNew(m), [])
    m.priorArt[0].absent = ' '
    red(m, /absent 要写查了哪里/)
  })
  it('R11：第一项不再要求 url / takeaway / decisionImpact，其余项照旧要求', () => {
    const m = full()
    delete m.priorArt[2].decisionImpact
    const out = runNew(m).join('\n')
    assert.doesNotMatch(out, /priorArt\[0\] 缺/)
    assert.match(out, /priorArt\[2\] 缺 decisionImpact/)
  })

  // R12
  it('R12 反例：appearsIn 漏了一个引用方（设计实验室的屏）→ 红', () => {
    const m = full()
    m.appearsIn = m.appearsIn.slice(0, 1)
    red(m, /thingLabKit\.tsx 直接引用了 src\/design\/Thing\.tsx，却不在 appearsIn 里/)
  })
  it('R12 正例：漏掉的引用方写进 appearsInExcluded 并写理由 → 绿；理由为空 → 红', () => {
    const m = full()
    m.appearsIn = m.appearsIn.slice(0, 1)
    m.appearsInExcluded = [{ file: 'src/devlab/designLab/thing/thingLabKit.tsx', reason: '' }]
    red(m, /appearsInExcluded\[0\] 缺 reason/)
    m.appearsInExcluded[0].reason = '只取了常量，不画这个组件'
    assert.deepEqual(runNew(m), [])
  })
  it('R12 反例：缺 appearsIn / 缺 components / 组件文件不存在 → 红', () => {
    const m = full()
    delete m.appearsIn
    red(m, /缺 appearsIn/)
    const n = full()
    delete n.components
    red(n, /缺 components/)
    const k = full()
    k.components = ['src/design/Ghost.tsx']
    red(k, /Ghost\.tsx 在仓库里找不到/)
  })
  it('R12 反例：一处没对应同目录的板 / 本清单的元素 → 红', () => {
    const m = full()
    m.appearsIn[0].board = 'Elsewhere'
    m.appearsIn[1].element = 'ghost'
    const out = runNew(m).join('\n')
    assert.match(out, /appearsIn\[0\]\.board「Elsewhere」不是同目录里的板名/)
    assert.match(out, /appearsIn\[1\]\.element「ghost」不是本清单的元素 id/)
  })
  it('R12：两个组件互相引用不算一处；{ none: 原因 } 且没有 components → 绿', () => {
    const m = full()
    m.components = [COMPONENT, 'src/workbench/PanelA.tsx']
    REFERRERS['src/workbench/PanelA.tsx'] = []
    m.appearsIn = m.appearsIn.slice(1)
    assert.deepEqual(runNew(m), [])
    delete REFERRERS['src/workbench/PanelA.tsx']
    const n = full()
    delete n.components
    n.appearsIn = { none: '安装窗口只有这一处，不复用生产组件' }
    assert.deepEqual(runNew(n), [])
  })

  // R13
  it('R13 反例：收进菜单的普查项缺「多久用一次」→ 红', () => {
    const m = full()
    delete m.functionCensus[1].frequency
    red(m, /旧功能「导出」收进菜单，缺 frequency/)
  })
  it('R13 反例：收进菜单缺「同类产品放在哪」/ 留下来的缺「删掉它会做错什么」/ 去处种类写错 → 红', () => {
    const m = full()
    delete m.functionCensus[1].peerPlacement
    delete m.functionCensus[0].ifRemoved
    m.functionCensus[2].placement = 'hidden'
    const out = runNew(m).join('\n')
    assert.match(out, /缺 peerPlacement/)
    assert.match(out, /旧功能「标题」留下来了，缺 ifRemoved/)
    assert.match(out, /旧功能「旧开关」缺 placement/)
  })
  it('R13 正例：删掉的项不用写 ifRemoved（full 里的「旧开关」）', () => assert.deepEqual(runNew(full()), []))

  // R14
  it('R14 反例：缺「以前定过什么」→ 红', () => {
    const m = full()
    delete m.priorDecisions
    red(m, /缺 priorDecisions/)
  })
  it('R14 反例：一行缺「现在还算不算数」/ 空数组 / notFound 为空 → 红；写了查了哪里 → 绿', () => {
    const m = full()
    delete m.priorDecisions[0].stillValid
    red(m, /priorDecisions\[0\] 缺 stillValid/)
    m.priorDecisions = []
    red(m, /至少 1 行/)
    m.priorDecisions = { notFound: '' }
    red(m, /notFound: 查了哪里/)
    m.priorDecisions = { notFound: '查了拍板记录、计划表、这块组件注释里的「用户拍板」，没查到' }
    assert.deepEqual(runNew(m), [])
  })

  // R15
  it('R15 反例：有 max-count 的元素没被边界表指到 → 红', () => {
    const m = full()
    m.boundarySheet[0].element = 'topbar.title'
    red(m, /元素 group\.header 的状态有 max-count，会被数据撑开，但没有一行的 element 指到它/)
  })
  it('R15 反例：边界表写 { none } 却有 long-text 的元素 → 红', () => {
    const m = full()
    m.elements[0].states = ['zh-en', 'long-text']
    m.boundarySheet = { none: '没有会被撑开的地方' }
    const out = runNew(m).join('\n')
    assert.match(out, /元素 topbar\.title 的状态有 long-text.*边界表写了 \{ none \}/)
    assert.match(out, /元素 group\.header 的状态有 max-count/)
  })

  it('真跑：日期目录 2026-11-15 的板缺新栏 → 门岗红；2026-11-14 目录同一张不红', async () => {
    const root = makeTempDir('bp-inputs-')
    const main = path.join(root, 'main-day'); fs.mkdirSync(main)
    for (const [day, name] of [['2026-11-14', 'Old'], ['2026-11-15', 'Fresh']]) {
      fs.mkdirSync(path.join(root, day))
      const priorArt = [1, 2, 3].map((n) => ({ url: `https://example.com/${n}`, takeaway: 'a', decisionImpact: 'b' }))
      fs.writeFileSync(path.join(root, day, `${name}.board.json`), JSON.stringify({ board: name, stage: 'built', priorArt, boundarySheet: { none: '只有固定按钮' }, elements: [], decor: [], functionCensus: [] }))
    }
    const errors = await runBoardParity({ dir: main, root })
    fs.rmSync(root, { recursive: true, force: true })
    for (const pattern of [/priorArt 第一项/, /缺 appearsIn/, /缺 priorDecisions/]) {
      assert.ok(errors.some((e) => e.startsWith('[Fresh]') && pattern.test(e)), `${pattern}\n${errors.join('\n')}`)
    }
    assert.ok(!errors.some((e) => e.startsWith('[Old]')), errors.join('\n'))
  })
})

describe('R12 引用方扫描（makeReferrerScanner）：只看直接引用；桶文件换成从桶里取了组件的文件；测试和只取类型的不算', () => {
  it('在临时仓库里数引用方', () => {
    const root = makeTempDir('bp-referrers-')
    const write = (rel, text) => {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
      fs.writeFileSync(path.join(root, rel), text)
    }
    write('src/design/Thing.tsx', 'export function Thing() { return null }\nexport type ThingProps = {}\n')
    write('src/design/Other.tsx', 'export function Other() { return null }\n')
    write('src/design/index.ts', "export { Thing } from './Thing'\nexport type { ThingProps } from './Thing'\nexport { Other } from './Other'\n")
    write('src/workbench/Direct.tsx', "import { Thing } from '../design/Thing'\nexport const a = Thing\n")
    write('src/workbench/ViaBarrel.tsx', "import { Thing, Other } from '../design'\nexport const b = [Thing, Other]\n")
    write('src/workbench/OtherOnly.tsx', "import { Other } from '../design'\nexport const c = Other\n")
    write('src/workbench/TypeOnly.tsx', "import type { ThingProps } from '../design/Thing'\nexport type D = ThingProps\n")
    write('src/workbench/Lazy.tsx', "export const load = () => import('../design/Thing')\n")
    write('src/workbench/Direct.test.tsx', "import { Thing } from '../design/Thing'\n")
    write('src/devlab/designLab/thing/thingLabKit.tsx', "import { Thing } from '../../../design/Thing'\nexport const e = Thing\n")
    write('src/workbench/Deep.tsx', "import { a } from './Direct'\nexport const f = a\n")
    const scan = makeReferrerScanner(root)
    const got = scan('src/design/Thing.tsx')
    assert.ok(scan('src/design/Ghost.tsx') === null)
    fs.rmSync(root, { recursive: true, force: true })
    assert.deepEqual(got, ['src/devlab/designLab/thing/thingLabKit.tsx', 'src/workbench/Direct.tsx', 'src/workbench/Lazy.tsx', 'src/workbench/ViaBarrel.tsx'])
  })
})

describe('compareBoardManifests：出图依据栏不算合同差异', () => {
  const manifest = () => ({ Main: { ...base(), functionCensus: [{ function: '标题', before: '顶栏标题', after: 'topbar.title' }] } })
  it('只补 components / appearsIn / priorDecisions 和普查新列 → 无差异', () => {
    const head = manifest()
    Object.assign(head.Main, { components: ['src/design/Thing.tsx'], appearsIn: { none: '一处' }, appearsInExcluded: [], priorDecisions: { notFound: '查了拍板记录' } })
    Object.assign(head.Main.functionCensus[0], { placement: 'menu', frequency: '不知道', peerPlacement: '右上角', ifRemoved: '找不到' })
    assert.equal(compareBoardManifests(manifest(), head).changed, false)
  })
  it('元素、普查去处、先例变了 → 照旧算差异', () => {
    const elementChanged = manifest()
    elementChanged.Main.elements[0].status = 'missing'
    assert.equal(compareBoardManifests(manifest(), elementChanged).changed, true)
    const censusChanged = manifest()
    censusChanged.Main.functionCensus[0].after = 'group.header'
    assert.equal(compareBoardManifests(manifest(), censusChanged).changed, true)
    const priorChanged = manifest()
    priorChanged.Main.priorArt = [{ kind: 'same-surface', product: '甲', absent: '没有' }]
    assert.equal(compareBoardManifests(manifest(), priorChanged).changed, true)
  })
})

describe('R8 PR 认领的拍板图元素必须有去处', () => {
  const body = ['## 拍板图', '- Main: topbar.title, group.header', '', '## 功能分类', '无']
  it('解析：只读 ## 拍板图 一节', () => {
    assert.deepEqual(parsePrBoardClaims(body.join('\n')), [{ board: 'Main', ids: ['topbar.title', 'group.header'] }])
  })
  it('没有这一节 → 不认领、照过', () => assert.deepEqual(parsePrBoardClaims('## 功能分类\n无'), []))
  it('反例：认领的元素还是 missing → 红', () => {
    const manifests = { Main: base() }
    assert.match(checkPrBoardClaims(body.join('\n'), manifests).join('\n'), /group\.header 还是 missing/)
  })
  it('反例：认领的元素不在清单里 → 红', () => {
    const manifests = { Main: base() }
    assert.match(checkPrBoardClaims('## 拍板图\n- Main: 不存在的元素', manifests).join('\n'), /不在清单里/)
  })
  it('正例：认领的元素是 implemented → 绿', () => {
    const manifests = { Main: base() }
    assert.deepEqual(checkPrBoardClaims('## 拍板图\n- Main: topbar.title', manifests), [])
  })
  it('正例：deferred 带用户原话和日期 → 绿', () => {
    const m = base()
    m.elements[1].status = 'deferred'
    delete m.elements[1].owner
    m.elements[1].userDecision = { quote: '先放着', date: '2026-10-10' }
    assert.deepEqual(checkPrBoardClaims('## 拍板图\n- Main: group.header', { Main: m }), [])
  })
})

describe('板源哈希：默认模式不起浏览器，靠哈希判断板改没改', () => {
  const src = { 'preview/A.html': '<p>abc</p>', 'source/A.dc.html': 'dc' }
  const hashOf = (files) => hashBoardSourceFiles(files)
  it('反例：改一个字节、不重抽 → 红', () => {
    const recorded = hashOf(src)
    const edited = { ...src, 'preview/A.html': '<p>abd</p>' }
    const errors = checkSourceHash({ board: 'A', candidatesDoc: { sourceSha256: recorded }, currentHash: hashOf(edited) })
    assert.match(errors.join('\n'), /板源已改.*node scripts\/board-extract\.mjs/)
  })
  it('反例：候选文件里缺哈希 → 红', () => {
    const errors = checkSourceHash({ board: 'A', candidatesDoc: { candidates: [] }, currentHash: hashOf(src) })
    assert.match(errors.join('\n'), /缺 sourceSha256/)
  })
  it('正例：哈希一致 → 绿', () => {
    const errors = checkSourceHash({ board: 'A', candidatesDoc: { sourceSha256: hashOf(src) }, currentHash: hashOf(src) })
    assert.deepEqual(errors, [])
  })
  it('哈希对字节敏感、对文件顺序不敏感', () => {
    assert.notEqual(hashOf({ a: 'x' }), hashOf({ a: 'y' }))
    assert.equal(hashOf({ a: '1', b: '2' }), hashOf({ b: '2', a: '1' }))
  })
})

describe('门岗结构：默认路径不 import 也不调用 playwright', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const gate = fs.readFileSync(path.join(here, 'check-board-parity.mjs'), 'utf8')
  const staticImports = gate.split('\n').filter((line) => /^import/.test(line))
  it('静态 import 里没有 playwright', () => {
    assert.equal(staticImports.some((line) => /playwright/.test(line)), false)
  })
  it('静态 import 的 board-extract 只带常量，抽取函数只在 --reextract 的动态 import 里', () => {
    const fromExtract = staticImports.filter((line) => /board-extract/.test(line)).join('\n')
    assert.doesNotMatch(fromExtract, /extractAllBoards|renderCandidatesFile/)
    assert.match(gate, /if \(reextract\) \{[\s\S]*await import\('\.\/board-extract\.mjs'\)/)
  })
  it('默认模式真跑通：PLAYWRIGHT_BROWSERS_PATH 指空目录也 exit 0', () => {
    const empty = fs.mkdtempSync(path.join(process.env.TMPDIR || process.env.TEMP || '.', 'bp-nobrowser-'))
    const r = spawnSync(process.execPath, [path.join(here, 'check-board-parity.mjs')], {
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: empty },
      encoding: 'utf8',
    })
    fs.rmSync(empty, { recursive: true, force: true })
    assert.equal(r.status, 0, r.stdout + r.stderr)
  })
})

describe('其它日期目录的板（2026-10-16：新板对门岗和合并前扫描都不可见）', () => {
  const tmpRoot = () => fs.mkdtempSync(path.join(process.env.TMPDIR || process.env.TEMP || '.', 'bp-dated-'))
  const writeBoard = (root, day, board, manifest, withCandidates = false) => {
    const dir = path.join(root, day)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${board}.board.json`), JSON.stringify(manifest))
    if (withCandidates) fs.writeFileSync(path.join(dir, `${board}.candidates.json`), JSON.stringify({ candidates: [] }))
    return dir
  }
  const textOnly = (overrides = {}) => ({
    board: 'TextOnly', stage: 'built',
    elements: [{ id: 'tier.popover', label: '弹层', candidates: [], status: 'implemented', assertion: 'board:TextOnly/tier.popover', states: ['zh-en'], ...overrides }],
    decor: [], functionCensus: [{ function: '旧弹层', before: '三档', after: 'tier.popover' }],
  })
  it('正例：只有清单的新板被找到，且 `## 拍板图` 能认领到它', async () => {
    const root = tmpRoot()
    const main = path.join(root, 'main-day'); fs.mkdirSync(main)
    writeBoard(root, 'later-day', 'TextOnly', textOnly())
    writeBoard(root, 'later-day', 'Drawn', { board: 'Drawn', stage: 'built', elements: [], decor: [], functionCensus: [] }, true)
    const found = findDatedBoards(root, main)
    assert.deepEqual(found.map((entry) => [entry.board, entry.manifestOnly]).sort(), [['Drawn', false], ['TextOnly', true]])
    const manifests = loadManifests(main, root)
    assert.deepEqual(checkPrBoardClaims('## 拍板图\n- TextOnly: tier.popover', manifests), [])
    fs.rmSync(root, { recursive: true, force: true })
  })
  it('反例：只有清单的新板也按 R4 查——断言名不在走查里 → 红', async () => {
    const root = tmpRoot()
    const main = path.join(root, 'main-day'); fs.mkdirSync(main)
    writeBoard(root, 'later-day', 'TextOnly', textOnly({ assertion: 'board:TextOnly/never-written-anywhere' }))
    const errors = await runBoardParity({ dir: main, root })
    assert.ok(errors.some((e) => /\[TextOnly\].*never-written-anywhere/.test(e)), errors.join('\n'))
    fs.rmSync(root, { recursive: true, force: true })
  })
})

describe('V-1203 F2：发现到的每张新日期板都跑完整规则（带候选文件的也不例外）', () => {
  const tmpRoot = () => fs.mkdtempSync(path.join(process.env.TMPDIR || process.env.TEMP || '.', 'bp-v1203-'))
  const bad = { board: 'ReviewProbe', stage: 'built', elements: [{ id: 'probe', status: 'implemented', assertion: 'NEVER_EXISTS_V1203', states: [] }], functionCensus: [{ function: 'old', after: 'missing' }] }
  it('反例：带人工候选文件、内容坏的新板 → 红（断言不在走查、states 空、旧功能没去处、候选未认领）', async () => {
    const root = tmpRoot()
    const main = path.join(root, 'main-day'); fs.mkdirSync(main)
    const day = path.join(root, '2099-01-01'); fs.mkdirSync(day)
    fs.writeFileSync(path.join(day, 'ReviewProbe.board.json'), JSON.stringify(bad))
    fs.writeFileSync(path.join(day, 'ReviewProbe.candidates.json'), JSON.stringify({ board: 'ReviewProbe', extractor: 'manual-domain-census@1', candidates: [{ id: 'unclaimed' }] }))
    const errors = (await runBoardParity({ dir: main, root })).filter((e) => e.includes('ReviewProbe'))
    fs.rmSync(root, { recursive: true, force: true })
    for (const pattern of [/NEVER_EXISTS_V1203/, /缺 states/, /没有去处/, /候选未认领.*unclaimed/]) assert.ok(errors.some((e) => pattern.test(e)), `${pattern}\n${errors.join('\n')}`)
  })
  it('反例：抽取出来的候选文件（board-extract）板源哈希对不上 → 红', async () => {
    const root = tmpRoot()
    const main = path.join(root, 'main-day'); fs.mkdirSync(main)
    const day = path.join(root, '2099-01-01'); fs.mkdirSync(day)
    fs.writeFileSync(path.join(day, 'ReviewProbe.board.json'), JSON.stringify({ board: 'ReviewProbe', stage: 'built', elements: [], decor: [], functionCensus: [] }))
    fs.writeFileSync(path.join(day, 'ReviewProbe.candidates.json'), JSON.stringify({ board: 'ReviewProbe', extractor: 'board-extract@1', sourceSha256: 'not-the-hash', candidates: [] }))
    const errors = (await runBoardParity({ dir: main, root })).filter((e) => e.includes('ReviewProbe'))
    fs.rmSync(root, { recursive: true, force: true })
    assert.ok(errors.some((e) => /板改了|sourceSha256|哈希/.test(e)), errors.join('\n'))
  })
  it('反例：候选文件既没有板源哈希、也没声明人工普查 → 红（不许不声不响地免掉哈希核对）', async () => {
    const root = tmpRoot()
    const main = path.join(root, 'main-day'); fs.mkdirSync(main)
    const day = path.join(root, '2099-01-01'); fs.mkdirSync(day)
    fs.writeFileSync(path.join(day, 'ReviewProbe.board.json'), JSON.stringify({ board: 'ReviewProbe', stage: 'built', elements: [], decor: [], functionCensus: [] }))
    fs.writeFileSync(path.join(day, 'ReviewProbe.candidates.json'), JSON.stringify({ board: 'ReviewProbe', candidates: [] }))
    const errors = (await runBoardParity({ dir: main, root })).filter((e) => e.includes('ReviewProbe'))
    fs.rmSync(root, { recursive: true, force: true })
    assert.ok(errors.length > 0, '没有哈希也没声明人工普查的候选文件必须红')
  })
})

describe('V-1203 复验 R1：跨日期同名板——校验按「日期目录 + 板名」逐张读，同名不能互相顶替', () => {
  const tmpRoot = () => fs.mkdtempSync(path.join(process.env.TMPDIR || process.env.TEMP || '.', 'bp-dup-'))
  const good = { board: 'ReviewProbe', stage: 'built', elements: [{ id: 'probe', candidates: [], status: 'implemented', assertion: 'board:ReviewProbe/probe-ok', states: ['zh-en'] }], decor: [], functionCensus: [{ function: 'old', after: 'probe' }] }
  const bad = { board: 'ReviewProbe', stage: 'built', elements: [{ id: 'probe', status: 'implemented', assertion: 'NEVER_EXISTS_V1203_R1', states: [] }], functionCensus: [{ function: 'old', after: 'missing' }] }
  const setup = (withCandidates) => {
    const root = tmpRoot()
    const main = path.join(root, 'main-day'); fs.mkdirSync(main)
    for (const [day, manifest] of [['2099-01-01', good], ['2099-01-02', bad]]) {
      const dir = path.join(root, day); fs.mkdirSync(dir)
      fs.writeFileSync(path.join(dir, 'ReviewProbe.board.json'), JSON.stringify(manifest))
      if (withCandidates) fs.writeFileSync(path.join(dir, 'ReviewProbe.candidates.json'), JSON.stringify({ extractor: 'manual-review', candidates: [] }))
    }
    return { root, main }
  }
  for (const withCandidates of [false, true]) {
    it(`反例（${withCandidates ? '两份都带人工候选' : '两份都只有清单'}）：第二份坏清单照样报它自己的错，且同名本身也红`, async () => {
      const { root, main } = setup(withCandidates)
      const errors = (await runBoardParity({ dir: main, root })).filter((e) => e.includes('ReviewProbe'))
      fs.rmSync(root, { recursive: true, force: true })
      for (const pattern of [/NEVER_EXISTS_V1203_R1/, /缺 states/, /没有去处/, /同名/]) assert.ok(errors.some((e) => pattern.test(e)), `${pattern}\n${errors.join('\n')}`)
    })
  }
  it('反例：PR 按板名认领一张重名板 → 红（认领有歧义，不能挑第一份当真）', () => {
    const { root, main } = setup(false)
    const errors = checkPrBoardClaims('## 拍板图\n- ReviewProbe: probe', loadManifests(main, root))
    fs.rmSync(root, { recursive: true, force: true })
    assert.ok(errors.some((e) => /重名|歧义/.test(e)), errors.join('\n'))
  })
  it('发现器把日期目录带进身份：两张同名板都被找到', () => {
    const { root, main } = setup(false)
    const found = findDatedBoards(root, main).map((entry) => `${path.basename(entry.dir)}/${entry.board}`).sort()
    fs.rmSync(root, { recursive: true, force: true })
    assert.deepEqual(found, ['2099-01-01/ReviewProbe', '2099-01-02/ReviewProbe'])
  })
})

describe('板名：磁盘上每一张板都能被 ## 拍板图 认领（2026-10-24：IconsF1 / ComposerB3 / Director3dbox 带数字认不出）', () => {
  const onDisk = [...BOARD_NAMES, ...findDatedBoards().map((b) => b.board)]
  it('每张板的名字都符合板名规则，且认领行解析得出来', () => {
    assert.ok(onDisk.length > BOARD_NAMES.length, '应读到日期目录里的板')
    for (const board of onDisk) {
      assert.match(board, BOARD_NAME, `${board}.board.json 的名字不符合板名规则，认领行认不出它`)
      assert.deepEqual(parsePrBoardClaims(`## 拍板图\n- ${board}: x`), [{ board, ids: ['x'] }], `${board} 认领不出来`)
    }
  })
  it('反例：带数字的板名照样认得出', () => {
    assert.deepEqual(parsePrBoardClaims('## 拍板图\n- IconsF1: node.toolbar, topbar'), [{ board: 'IconsF1', ids: ['node.toolbar', 'topbar'] }])
  })
})
