// 设计图对账门岗的必红测试：每条规则一个反例（应红）+ 一个正例（应绿）。
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { BOARD_NAME, BOARD_STATES, checkBoardManifest, checkBoundarySheet, checkPriorArt, checkPrBoardClaims, checkSourceHash, findDatedBoards, loadManifests, parsePrBoardClaims, runBoardParity } from './check-board-parity.mjs'
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
    const root = fs.mkdtempSync(path.join(process.env.TMPDIR || process.env.TEMP || '.', 'bp-bsheet-'))
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
