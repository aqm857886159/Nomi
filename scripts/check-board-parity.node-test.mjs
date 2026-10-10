// 设计图对账门岗的必红测试：每条规则一个反例（应红）+ 一个正例（应绿）。
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkBoardManifest, checkPrBoardClaims, checkSourceHash, parsePrBoardClaims } from './check-board-parity.mjs'
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
