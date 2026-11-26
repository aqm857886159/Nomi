// 设计图对账门岗的必红测试：每条规则一个反例（应红）+ 一个正例（应绿）。
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { BOARD_NAME, BOARD_STATES, PEER_REGISTRY_REQUIRED_FROM, checkBoardManifest, checkBoundarySheet, checkElementComponents, checkPeerRegistry, checkPeerRegistryFile, checkPriorArt, checkPrBoardClaims, checkSourceHash, compareBoardManifests, findDatedBoards, formatBoardDebtReport, listBoardManifests, loadLegacyComponentBaseline, loadManifests, loadPeerRegistry, makeReferrerScanner, matchBoardActiveWork, parsePrBoardClaims, runBoardParity, summarizeBoardDebt } from './check-board-parity.mjs'
import { makeTempDir } from './_test-temp.mjs'
import { BOARD_NAMES } from './board-extract.mjs'
import { hashBoardSourceFiles } from './board-source-hash.mjs'

const CORPUS = "it('board:Main/topbar.title', () => {})"
const candidates = [{ id: '001-text-A' }, { id: '002-icon' }, { id: '003-text-B' }]
const base = () => ({
  board: 'Main',
  stage: 'explored',
  elements: [
    { id: 'topbar.title', label: '标题', candidates: ['001-text-A', '002-icon'], status: 'implemented', assertion: 'board:Main/topbar.title', component: 'src/ui/app-shell/shell/ShellTopBar.tsx', states: ['zh-en'] },
    { id: 'group.header', label: '分组框头', candidates: ['003-text-B'], status: 'missing', owner: 'I-groupheader', component: 'src/workbench/generationCanvas/nodes/GroupHeader.tsx', states: ['empty'] },
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

describe('R4 implemented 的认领候选必须有差异清单', () => {
  it('只有一个到处都能搜到的断言名也不能算已量过', () => {
    assert.match(run(base(), candidates, CORPUS).join('\n'), /差异清单/)
  })
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
    elements: [{ id: 'tier.popover', label: '弹层', candidates: [], status: 'implemented', assertion: 'board:TextOnly/tier.popover', component: 'src/workbench/ai/v4/AgentPanelV4Composer.tsx', states: ['zh-en'], ...overrides }],
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
  const good = { board: 'ReviewProbe', stage: 'built', elements: [{ id: 'probe', candidates: [], status: 'implemented', assertion: 'board:ReviewProbe/probe-ok', component: 'src/workbench/Probe.tsx', states: ['zh-en'] }], decor: [], functionCensus: [{ function: 'old', after: 'probe' }] }
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

describe('R16 同类产品登记表：先例按 Nomi 的定位选，不按好不好打开选（2026-11-21 用户要求修底层）', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const registry = { ...loadPeerRegistry(repoRoot), approval: { quote: '测试用', date: '2026-11-21' } }
  const realBoard = (dir, name) => JSON.parse(fs.readFileSync(path.join(repoRoot, 'docs/design/boards', dir, `${name}.board.json`), 'utf8'))
  const peerCheck = (manifest, date = PEER_REGISTRY_REQUIRED_FROM) => checkPeerRegistry({ board: 'Main', manifest, date, registry })
  // 这一例：2026-11-21 设置页调研按「免登录能打开」挑的三家
  const thisCase = () => ({
    priorArt: [
      { kind: 'same-surface', product: 'Chatbox', screenshotSha256: 'a'.repeat(64), seenOn: '2026-11-21', differences: [{ what: '三栏', why: '少一层' }] },
      { url: 'https://www.typingmind.com/', takeaway: 'TypingMind：模型不放在设置里', decisionImpact: '模型从选择器直达' },
      { url: 'https://vscode.dev/', takeaway: 'VS Code：长页就地改 + 搜索', decisionImpact: '不分页' },
    ],
  })

  it('反例（这一例）：第一项不是登记的同类、另两项是「不算同类」——三条都红', () => {
    const errors = peerCheck(thisCase()).join('\n')
    assert.match(errors, /priorArt\[0\] 的「Chatbox」不在同类产品登记表/)
    assert.match(errors, /priorArt\[0\] 用了 Chatbox/)
    assert.match(errors, /priorArt\[1\] 用了 TypingMind/)
    assert.match(errors, /priorArt\[2\] 用了 VS Code/)
  })
  it('反例（真实旧案）：2026-11-17 连接状态板第一项写 LibTV「没有这东西」，真正对照的是 Cherry Studio / Open WebUI / LibreChat——按新规则必须红', () => {
    const errors = peerCheck(realBoard('2026-11-17-model-connection-status', 'ModelConnectionStatus')).join('\n')
    assert.doesNotMatch(errors, /priorArt\[0\]/, 'LibTV 是登记的同类，第一项本身不该红')
    for (const product of ['Cherry Studio', 'Open WebUI', 'LibreChat']) assert.match(errors, new RegExp(`用了 ${product}`))
  })
  it('反例（真实旧案）：2026-11-07 引导板里借了 Cherry Studio、LobeChat——按新规则必须红', () => {
    const errors = peerCheck(realBoard('2026-11-07-onboarding', 'Onboarding')).join('\n')
    assert.match(errors, /用了 Cherry Studio/)
    assert.match(errors, /用了 LobeChat/)
  })
  it('正例（真实样本，不误伤）：定位一致的三块板——模式条、生成框参数、Agent 选择芯片——一条都不红', () => {
    assert.deepEqual(peerCheck(realBoard('2026-11-12-mode-bar', 'ModeBar')), [])
    assert.deepEqual(peerCheck(realBoard('2026-11-14-composer-params', 'ComposerParams')), [])
    assert.deepEqual(peerCheck(realBoard('2026-11-17-agent-selection', 'AgentSelectionChip')), [])
  })
  it('正例：可用性研究、平台规范这类中立来源不在登记表里，也不红（它们只是不能当第一项）', () => {
    const manifest = { priorArt: [
      { kind: 'same-surface', product: '可灵', absent: '查了 kling.ai/quickstart' },
      { url: 'https://www.nngroup.com/articles/empty-state-interface-design/', takeaway: 'NN/g：空状态要给直达关键任务的路', decisionImpact: '确认了' },
      { url: 'https://developer.apple.com/design/human-interface-guidelines/settings', takeaway: 'Apple：设置分组', decisionImpact: '确认了' },
    ] }
    assert.deepEqual(peerCheck(manifest), [])
  })
  it('别名也认：只写了链接（github.com/CherryHQ）、没写产品名，照样认出', () => {
    const manifest = { priorArt: [{ kind: 'same-surface', product: 'LibTV', absent: '查了更新日志' }, { url: 'https://github.com/CherryHQ/cherry-studio/blob/main/x.tsx', takeaway: '每家中转站一个登录按钮', decisionImpact: '改了' }] }
    assert.match(peerCheck(manifest).join('\n'), /用了 Cherry Studio/)
  })
  it('用户亲口同意的例外：这一项带 userApproved { quote, date } 就放行', () => {
    const manifest = thisCase()
    for (const item of manifest.priorArt) item.userApproved = { quote: '这次可以参考它的搜索', date: '2026-11-22' }
    assert.deepEqual(peerCheck(manifest), [])
  })
  it('只有原话没有日期、或只有日期没有原话，不算用户同意', () => {
    const manifest = thisCase()
    manifest.priorArt[0].userApproved = { quote: '可以' }
    manifest.priorArt[1].userApproved = { date: '2026-11-22' }
    const errors = peerCheck(manifest).join('\n')
    assert.match(errors, /priorArt\[0\]/)
    assert.match(errors, /priorArt\[1\]/)
  })
  it('更早的板不追溯：同样的内容放在登记表生效前一天，不查', () => {
    assert.deepEqual(peerCheck(thisCase(), '2026-11-21'), [])
  })
  it('读不到登记表就红，不默默放过', () => {
    assert.match(checkPeerRegistry({ board: 'Main', manifest: thisCase(), date: PEER_REGISTRY_REQUIRED_FROM, registry: null }).join('\n'), /读不到同类产品登记表/)
  })
  it('登记表本身：用户没拍板（approval 缺原话或日期）就红', () => {
    assert.match(checkPeerRegistryFile({ ...registry, approval: null }).join('\n'), /approval 要写用户拍板的原话和日期/)
    assert.deepEqual(checkPeerRegistryFile(registry), [])
  })
  it('登记表本身：同一家不能既是同类又不算同类；每家要写为什么、对照哪几块、怎么看得到', () => {
    const broken = structuredClone(registry)
    broken.notPeers[0].members.push({ product: 'LibTV', aliases: [] })
    broken.peers[0].surfaces = ['不存在的面']
    delete broken.peers[1].access
    const errors = checkPeerRegistryFile(broken).join('\n')
    assert.match(errors, /「libtv」同时在 peers 和 notPeers 里/)
    assert.match(errors, /不在 surfaces 词表里/)
    assert.match(errors, /peers\[1\] 缺 access/)
  })
  it('接进整张板的校验：checkBoardManifest 带上登记表才会查 R16', () => {
    const manifest = { ...base(), ...thisCase() }
    const errors = checkBoardManifest({ board: 'Main', manifest, candidates, assertionCorpus: CORPUS, date: PEER_REGISTRY_REQUIRED_FROM, peerRegistry: registry })
    assert.ok(errors.some((line) => /用了 TypingMind/.test(line)))
  })
})

describe('R17 元素 component 必填（非 dropped 且非 change=remove 必须写 component）', () => {
  const validElement = (overrides = {}) => ({
    id: 'ask.cost',
    label: '费用确认条',
    candidates: [],
    status: 'missing',
    owner: 'T-1',
    change: 'new',
    states: ['zh-en'],
    ...overrides,
  })
  const fullManifest = (elements) => ({
    board: 'SpendAskSplit',
    approvedOn: '2026-11-15',
    stage: 'built',
    priorArt: [
      { kind: 'same-surface', product: 'LibTV', absent: '查了公开页面' },
      { url: 'https://www.nngroup.com/articles/confirmation-dialog/', takeaway: '确认条只留动作和费用', decisionImpact: '拆成单行确认条' },
      { url: 'https://developer.apple.com/design/human-interface-guidelines/alerts', takeaway: '动作明确', decisionImpact: '按钮名写清楚' },
    ],
    boundarySheet: { none: '固定单行确认条' },
    appearsIn: { none: '只在对话输入框上方出现一次' },
    priorDecisions: { notFound: '首次拆开付费确认条' },
    elements,
    decor: [],
    functionCensus: [],
  })

  it('反例（付费确认板漏填）：既不是 dropped 也不是 change=remove 却缺 component → 必须红', () => {
    const manifest = fullManifest([
      validElement({ id: 'ask.title', status: 'implemented', change: 'remove', assertion: 'board:Main/topbar.title', owner: undefined }),
      validElement({ id: 'ask.old', status: 'dropped', owner: undefined, userDecision: { quote: '不要了', date: '2026-11-15' } }),
      validElement({ id: 'ask.cost', status: 'missing', change: 'new' }),
      validElement({ id: 'ask.params', status: 'implemented', change: 'changed', assertion: 'board:Main/topbar.title', owner: undefined }),
    ])
    const errors = checkBoardManifest({ board: 'SpendAskSplit', manifest, candidates: [], assertionCorpus: CORPUS, date: '2026-11-15-spend-ask-split' })
    const joined = errors.join('\n')
    assert.match(joined, /ask\.cost.*component/)
    assert.match(joined, /ask\.params.*component/)
    assert.doesNotMatch(joined, /ask\.title.*component/, 'change=remove 不需要 component')
    assert.doesNotMatch(joined, /ask\.old.*component/, 'dropped 不需要 component')
  })

  it('正例：补齐 component（字符串或 { file, action }）或标 dropped / change=remove → 整张板 0 错绿', () => {
    const manifest = fullManifest([
      validElement({ id: 'ask.title', status: 'implemented', change: 'remove', assertion: 'board:Main/topbar.title', owner: undefined }),
      validElement({ id: 'ask.old', status: 'dropped', owner: undefined, userDecision: { quote: '不要了', date: '2026-11-15' } }),
      validElement({ id: 'ask.cost', status: 'missing', change: 'new', component: 'src/workbench/ai/v4/SpendConfirmBar.tsx' }),
      validElement({ id: 'ask.params', status: 'implemented', change: 'changed', assertion: 'board:Main/topbar.title', owner: undefined, component: { file: 'src/workbench/ai/v4/SpendConfirmBar.tsx', action: '改' } }),
    ])
    const errors = checkBoardManifest({ board: 'SpendAskSplit', manifest, candidates: [], assertionCorpus: CORPUS, date: '2026-11-15-spend-ask-split' })
    assert.deepEqual(errors, [])
  })

  it('反例：component 写成空串或空对象也红', () => {
    const manifest = fullManifest([
      validElement({ id: 'a.empty', component: '   ' }),
      validElement({ id: 'b.emptyObj', component: { file: '  ', action: '新' } }),
    ])
    const errors = checkBoardManifest({ board: 'SpendAskSplit', manifest, candidates: [], assertionCorpus: CORPUS, date: '2026-11-15-spend-ask-split' })
    assert.match(errors.join('\n'), /a\.empty.*component/)
    assert.match(errors.join('\n'), /b\.emptyObj.*component/)
  })

  it('端到端 runBoardParity：新板（哪怕目录日期 2026-11-15）缺 component 必红，补齐后转绿', async () => {
    const root = makeTempDir('bp-r17-')
    try {
      const main = path.join(root, 'main-day'); fs.mkdirSync(main)
      const dir = path.join(root, '2026-11-15-spend-ask-split'); fs.mkdirSync(dir)
      const manifest = fullManifest([
        validElement({ id: 'ask.title', status: 'missing', change: 'remove', owner: 'T-1' }),
        validElement({ id: 'ask.cost', status: 'missing', change: 'new', owner: 'T-1' }),
      ])
      fs.writeFileSync(path.join(dir, 'SpendAskSplit.board.json'), JSON.stringify(manifest))
      const redErrors = (await runBoardParity({ dir: main, root })).filter((e) => e.includes('SpendAskSplit'))
      assert.ok(redErrors.some((e) => /ask\.cost.*component/.test(e)), redErrors.join('\n'))
      assert.ok(!redErrors.some((e) => /ask\.title.*component/.test(e)), 'change=remove 不红')

      manifest.elements[1].component = 'src/workbench/ai/v4/SpendConfirmBar.tsx'
      fs.writeFileSync(path.join(dir, 'SpendAskSplit.board.json'), JSON.stringify(manifest))
      const greenErrors = (await runBoardParity({ dir: main, root })).filter((e) => e.includes('SpendAskSplit'))
      assert.deepEqual(greenErrors, [])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('存量棘轮只减不增：历史冻结板在上限内放行，多漏 1 格立刻红；不在表内的新板上限 0', () => {
    const legacy = loadLegacyComponentBaseline()
    assert.ok(Object.keys(legacy).length > 0, '存量冻结表应非空')
    assert.equal(Object.hasOwn(legacy, '2026-11-07-onboarding/Onboarding'), false, '已 0 缺口的板不进冻结表')
    const oneMissing = { board: 'LegacyDemo', elements: [validElement({ id: 'e1' })] }
    const twoMissing = { board: 'LegacyDemo', elements: [validElement({ id: 'e1' }), validElement({ id: 'e2' })] }
    assert.deepEqual(checkElementComponents({ board: 'LegacyDemo', manifest: oneMissing, date: '2026-10-08', legacyComponentCounts: { '2026-10-08/LegacyDemo': 1 } }), [])
    assert.match(
      checkElementComponents({ board: 'LegacyDemo', manifest: twoMissing, date: '2026-10-08', legacyComponentCounts: { '2026-10-08/LegacyDemo': 1 } }).join('\n'),
      /涨到了 2 个（存量冻结上限 1/,
    )
  })
})

describe('拍板图欠账汇总与标红（summarizeBoardDebt / formatBoardDebtReport / matchBoardActiveWork）', () => {
  const rec = (board, dirName, elements, approvedOn) => ({
    board,
    dirName,
    boardKey: `${dirName}/${board}`,
    approvedOn,
    manifest: { board, approvedOn, elements },
  })

  it('超过 3 天有 missing 且无在途 PR/分支 → 标红列出；全部 implemented/dropped 绝不误报', () => {
    const records = [
      rec('UnclaimedOld', '2026-11-10-unclaimed-old', [{ id: 'a', status: 'missing', owner: 'unassigned' }, { id: 'b', status: 'in-progress', owner: 'x' }], '2026-11-10'),
      rec('Boundary3d', '2026-11-19-boundary', [{ id: 'a', status: 'missing', owner: 'x' }], '2026-11-19'),
      rec('InProgressOnly', '2026-11-01-inprog', [{ id: 'a', status: 'in-progress', owner: 'x' }], '2026-11-01'),
      rec('DoneAll', '2026-11-01-done', [
        { id: 'a', status: 'implemented', assertion: 'x' },
        { id: 'b', status: 'dropped', userDecision: { quote: '不要', date: '2026-11-01' } },
        { id: 'c', status: 'deferred', userDecision: { quote: '推迟', date: '2026-11-01' } },
      ], '2026-11-01'),
    ]
    const summary = summarizeBoardDebt(records, { now: new Date('2026-11-22T00:00:00Z') })
    assert.equal(summary.totalBoards, 4)
    assert.equal(summary.owedBoards, 3)
    assert.equal(summary.overdueBoards, 1)
    assert.deepEqual(summary.boards.map((b) => b.board), ['UnclaimedOld', 'Boundary3d', 'InProgressOnly'])
    assert.equal(summary.boards[0].overdue, true)
    assert.equal(summary.boards[0].ageDays, 12)
    assert.equal(summary.boards[1].overdue, false, '刚好 3 天不标超期（超过 3 天才标红）')
    assert.equal(summary.boards[2].overdue, false, '没有 missing、只有 in-progress 不标超期红')

    const textColor = formatBoardDebtReport(summary, { color: true })
    assert.ok(textColor.includes('\u001b[31m'), 'color=true 时超期项必须用 ANSI 红色高亮')
    assert.match(textColor, /🔴 \[超期\] 2026-11-10-unclaimed-old\/UnclaimedOld/)
    assert.doesNotMatch(textColor, /DoneAll/)

    const cleanSummary = summarizeBoardDebt([records[3]], { now: new Date('2026-11-22T00:00:00Z') })
    assert.equal(cleanSummary.owedBoards, 0)
    assert.match(formatBoardDebtReport(cleanSummary), /无欠账/)
  })

  it('有在途 PR（## 拍板图认领 / owner #PR）或未合入分支在做 → 不标红并展示在途项', () => {
    const rClaim = rec('SpendAskSplit', '2026-11-15-spend-ask-split', [{ id: 'ask.cost', status: 'missing', owner: 'T-1' }], '2026-11-15')
    const rBranch = rec('Director3dbox', '2026-10-16', [{ id: 'd.1', status: 'missing', owner: 'feat/director-3dbox-switch' }], '2026-10-04')
    const prs = [{ number: 1548, title: 'feat: spend ask', headRefName: 'feat/spend-ask-split', body: '## 拍板图\n- SpendAskSplit: ask.cost' }]
    const branches = ['origin/feat/spend-ask-split', 'feat/director-3dbox-switch']

    assert.deepEqual(matchBoardActiveWork(rClaim, { prs, branches }).map((w) => w.ref), ['#1548'])
    assert.deepEqual(matchBoardActiveWork(rBranch, { prs, branches }).map((w) => w.ref), ['feat/director-3dbox-switch'])

    // 拍板日期之前的旧分支不能掩盖新板欠账；PR 正文里顺口提到别的板 slug 也不算认领
    const rOnboarding = rec('Onboarding', '2026-11-07-onboarding', [{ id: 'o.1', status: 'missing', owner: 'S7a' }], '2026-11-07')
    const rComposer = rec('ComposerB3', '2026-10-18', [{ id: 'c.1', status: 'missing', owner: 'I-b1a' }], '2026-10-18')
    const staleBranch = { name: 'origin/feat/model-onboarding-discovery-20260912', committedAtMs: Date.UTC(2026, 8, 12) }
    const unrelatedPr = { number: 1615, title: 'test(shell): 顶栏入口接线', headRefName: 'test/nomi-entry-topbar-wiring', body: '顺带提了一句 composer-b3 历史背景' }
    assert.deepEqual(matchBoardActiveWork(rOnboarding, { prs: [], branches: [staleBranch] }), [])
    assert.deepEqual(matchBoardActiveWork(rComposer, { prs: [unrelatedPr], branches: [] }), [])

    const summary = summarizeBoardDebt([rClaim, rBranch], { now: new Date('2026-11-22T00:00:00Z'), prs, branches })
    assert.equal(summary.overdueBoards, 0)
    assert.match(formatBoardDebtReport(summary), /#1548 \(feat\/spend-ask-split\)/)
    assert.match(formatBoardDebtReport(summary), /feat\/director-3dbox-switch/)
  })

  it('listBoardManifests 作为唯一板读取器，能读出仓库全部已批板', () => {
    const records = listBoardManifests()
    assert.ok(records.length >= BOARD_NAMES.length)
    assert.ok(records.some((r) => r.board === 'Onboarding' && r.approvedOn === '2026-11-07'))
  })
})
