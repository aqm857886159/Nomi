import { makeTempDir } from './_test-temp.mjs'
// check:concept-owners 的阳性对照（R17.0：加规则前先验它会红；有豁免的规则再补一发反向控制）。
// 每条判据都在一个临时 git 仓库里先造一处违规看它红、再改回来看它绿；豁免条件（别名、另一个概念认领的同名定义、
// 旧形状住在主人文件里）各有一条「把豁免条件拿掉就红」的反向控制。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { findIdentityComparators } from './concept-owners-scan.mjs'
import { trustDomainOfPath } from './concept-owners-lib.mjs'
import { CONCEPT_OWNERS_DIR, conceptFileName } from './concept-registry-lib.mjs'
import { META_FILE, formatEntryJson, parseCatFileBatch } from './lib/entryDirectory.mjs'

const checker = fileURLToPath(new URL('./check-concept-owners.mjs', import.meta.url))
/** 登记表是目录（一个概念一个文件）：write() 遇到这个键就整目录重写。 */
const REGISTRY = CONCEPT_OWNERS_DIR
const BASELINE = 'scripts/concept-owners-baseline.json'

function concept(overrides = {}) {
  return {
    name: '落家',
    subject: 'catalog.landing',
    lifecycle: 'catalog',
    authority_kind: 'decision',
    trust_domain: 'shared',
    fact_kind: 'rule',
    migration_status: 'converged',
    owner: { path: 'electron/shared/landing.ts', symbol: 'compareLanding' },
    write_api: [
      { path: 'electron/shared/landing.ts', symbol: 'compareLanding' },
      { path: 'electron/shared/landing.ts', symbol: 'TIER_KEYS' },
    ],
    forbidden_derivations: [],
    allowed_consumers: ['src/consumer.ts'],
    since: '2026-09-22',
    notes: '测试用概念',
    ...overrides,
  }
}

function registry(concepts) {
  return { _schema: 'test', schema_version: 2, concepts }
}

function baseline(overrides = {}) {
  return { version: 1, note: 'test', second_write_ports: [], pending_write_doors: [], unregistered_boundaries: [], ...overrides }
}

const BASE_FILES = {
  'electron/shared/landing.ts': [
    "export const TIER_KEYS = new Set(['official', 'relay'])",
    'export function compareLanding(left: string, right: string): number {',
    '  return Number(TIER_KEYS.has(right)) - Number(TIER_KEYS.has(left))',
    '}',
  ].join('\n'),
  'src/consumer.ts': [
    "import { compareLanding } from '../electron/shared/landing'",
    "export const ordered = ['a', 'b'].sort(compareLanding)",
  ].join('\n'),
}

/** 把一份登记表对象落成目录：_meta.json + 每个概念一个 <subject>.json；字符串 = 一个坏掉的概念文件。 */
function writeRegistry(root, value) {
  const dir = path.join(root, REGISTRY)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  if (typeof value === 'string') {
    fs.writeFileSync(path.join(dir, META_FILE), formatEntryJson({ _schema: 'test', schema_version: 2 }))
    fs.writeFileSync(path.join(dir, 'catalog.broken.json'), value)
    return
  }
  const { concepts, ...meta } = value
  fs.writeFileSync(path.join(dir, META_FILE), formatEntryJson(meta))
  for (const item of concepts) fs.writeFileSync(path.join(dir, conceptFileName(item.subject)), formatEntryJson(item))
}

function write(root, files) {
  for (const [file, contents] of Object.entries(files)) {
    if (file === REGISTRY) {
      writeRegistry(root, contents)
      continue
    }
    const target = path.join(root, file)
    if (contents === null) {
      fs.rmSync(target, { force: true })
      continue
    }
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, typeof contents === 'string' ? contents : `${JSON.stringify(contents, null, 2)}\n`)
  }
}

function git(root, ...args) {
  const result = spawnSync('git', ['-c', 'user.email=gate@test.local', '-c', 'user.name=gate', ...args], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  return result.stdout.trim()
}

/** 一个临时仓库：基础文件 + 登记表 + 基线，提交一次作为参照提交。 */
function makeRepo({ files = {}, concepts = [concept()], base = baseline() } = {}) {
  const root = makeTempDir('nomi-concept-owners-')
  write(root, { ...BASE_FILES, ...files, [REGISTRY]: registry(concepts), [BASELINE]: base })
  git(root, 'init', '-q')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'base')
  const baseRef = git(root, 'rev-parse', 'HEAD')
  return { root, baseRef }
}

function run(repo, args = [], { baseRef = repo.baseRef } = {}) {
  const env = { ...process.env, CONCEPT_OWNERS_BASE_REF: baseRef }
  delete env.ROOT_CAUSE_BASE_REF
  const result = spawnSync(process.execPath, [checker, '--repo-root', repo.root, ...args], { encoding: 'utf8', env })
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` }
}

function cleanup(repo) {
  fs.rmSync(repo.root, { recursive: true, force: true })
}

test('干净的登记表与代码是绿的', () => {
  const repo = makeRepo()
  try {
    const result = run(repo)
    assert.equal(result.status, 0, result.output)
    assert.match(result.output, /✅ 概念 owner 门岗/)
  } finally {
    cleanup(repo)
  }
})

test('第二写口（09-22 供应商落家的形状）：渲染层再定义一份比较子与分级表 → 红；删掉 → 绿', () => {
  const repo = makeRepo()
  try {
    write(repo.root, {
      'src/config/modelIdentity.ts': [
        "const TIER_KEYS = new Set(['official'])",
        'export function compareLanding(left: string, right: string): number {',
        '  return Number(TIER_KEYS.has(left)) - Number(TIER_KEYS.has(right))',
        '}',
      ].join('\n'),
    })
    const red = run(repo)
    assert.equal(red.status, 1, red.output)
    assert.match(red.output, /second-write-port/)
    assert.match(red.output, /src\/config\/modelIdentity\.ts:2 · compareLanding/)
    assert.match(red.output, /src\/config\/modelIdentity\.ts:1 · TIER_KEYS/)

    write(repo.root, { 'src/config/modelIdentity.ts': "export { compareLanding } from '../../electron/shared/landing'\n" })
    const green = run(repo)
    assert.equal(green.status, 0, green.output)
  } finally {
    cleanup(repo)
  }
})

test('反向控制：选择器别名不算定义；同一处改成自己实现一份就红', () => {
  const repo = makeRepo()
  try {
    write(repo.root, {
      'src/consumer.ts': [
        "declare function useStore<T>(select: (state: { compareLanding: (a: string, b: string) => number }) => T): T",
        'export function useOrder(): string[] {',
        '  const compareLanding = useStore((state) => state.compareLanding)',
        "  return ['a'].sort(compareLanding)",
        '}',
      ].join('\n'),
    })
    assert.equal(run(repo).status, 0)
    write(repo.root, {
      'src/consumer.ts': [
        'export function useOrder(): string[] {',
        '  const compareLanding = (left: string, right: string) => left.localeCompare(right)',
        "  return ['a'].sort(compareLanding)",
        '}',
      ].join('\n'),
    })
    const red = run(repo)
    assert.equal(red.status, 1, red.output)
    assert.match(red.output, /src\/consumer\.ts:2 · compareLanding/)
  } finally {
    cleanup(repo)
  }
})

test('反向控制：另一个概念明确认领的同名定义是账上写明的判断；撤掉那条登记就红', () => {
  const homonym = concept({
    name: '出站模型名归一',
    subject: 'provider.wire-model-id',
    lifecycle: 'execution',
    trust_domain: 'main',
    owner: { path: 'electron/wire.ts', symbol: 'TIER_KEYS' },
    write_api: [{ path: 'electron/wire.ts', symbol: 'TIER_KEYS' }],
    allowed_consumers: [],
  })
  const repo = makeRepo({ files: { 'electron/wire.ts': "export const TIER_KEYS = new Set(['wire'])\n" }, concepts: [concept(), homonym] })
  try {
    assert.equal(run(repo).status, 0)
    write(repo.root, { [REGISTRY]: registry([concept()]) })
    const red = run(repo)
    assert.equal(red.status, 1, red.output)
    assert.match(red.output, /electron\/wire\.ts:1 · TIER_KEYS/)
  } finally {
    cleanup(repo)
  }
})

test('契约槽位：写接口登记在接口成员上（注入的钩子）时，别处给槽位填实现不算第二写口；槽位删了就是主人不在', () => {
  const slotConcept = concept({
    name: '提交准入口',
    subject: 'production.submission-admission',
    lifecycle: 'execution',
    authority_kind: 'gateway',
    trust_domain: 'main',
    owner: { path: 'electron/outbox.ts', symbol: 'submitOnce' },
    write_api: [
      { path: 'electron/outbox.ts', symbol: 'submitOnce' },
      { path: 'electron/outbox.ts', symbol: 'beforeDispatch' },
    ],
    allowed_consumers: [],
  })
  const repo = makeRepo({
    files: {
      'electron/outbox.ts': [
        'export interface OutboxDependencies { beforeDispatch?: (job: string) => void }',
        'export function submitOnce(deps: OutboxDependencies, job: string): void { deps.beforeDispatch?.(job) }',
      ].join('\n'),
      'electron/wiring.ts': [
        "import { submitOnce } from './outbox'",
        "export const run = () => submitOnce({ beforeDispatch: (job) => { if (!job) throw new Error('no') } }, 'j')",
      ].join('\n'),
    },
    concepts: [concept(), slotConcept],
  })
  try {
    const green = run(repo)
    assert.equal(green.status, 0, green.output)

    write(repo.root, { 'electron/rival.ts': 'export function submitOnce(): void {}\n' })
    const rival = run(repo)
    assert.equal(rival.status, 1, rival.output)
    assert.match(rival.output, /electron\/rival\.ts:1 · submitOnce/)
    assert.doesNotMatch(rival.output, /wiring\.ts:\d+ · beforeDispatch/)

    write(repo.root, {
      'electron/rival.ts': null,
      'electron/outbox.ts': 'export function submitOnce(job: string): void { void job }\n',
    })
    const slotGone = run(repo)
    assert.equal(slotGone.status, 1, slotGone.output)
    assert.match(slotGone.output, /owner-unresolved/)
    assert.match(slotGone.output, /electron\/outbox\.ts · beforeDispatch/)
  } finally {
    cleanup(repo)
  }
})

test('禁止的旧形状：住在主人文件里放行，别处再定义就红', () => {
  const withForbidden = concept({
    forbidden_derivations: [{ symbol: 'LEGACY_TIER_KEYS', kind: 'definition', why: '旧的第二张分级表' }],
  })
  const repo = makeRepo({
    files: { 'electron/shared/landing.ts': `${BASE_FILES['electron/shared/landing.ts']}\nexport const LEGACY_TIER_KEYS = TIER_KEYS\n` },
    concepts: [withForbidden],
  })
  try {
    assert.equal(run(repo).status, 0)
    write(repo.root, { 'src/legacy.ts': "export const LEGACY_TIER_KEYS = new Set(['official'])\n" })
    const red = run(repo)
    assert.equal(red.status, 1, red.output)
    assert.match(red.output, /列为禁止的旧形状 LEGACY_TIER_KEYS/)
  } finally {
    cleanup(repo)
  }
})

test('主人不在了：写接口在登记的文件里找不到定义 → 红', () => {
  const repo = makeRepo()
  try {
    write(repo.root, { 'electron/shared/landing.ts': "export const TIER_KEYS = new Set(['official'])\n" })
    const red = run(repo)
    assert.equal(red.status, 1, red.output)
    assert.match(red.output, /owner-unresolved/)
    assert.match(red.output, /electron\/shared\/landing\.ts · compareLanding/)
  } finally {
    cleanup(repo)
  }
})

test('登记表结构：缺字段、旧字段名、枚举错、trust_domain 与路径不符、计数键重复都红', () => {
  const cases = [
    [(c) => { delete c.lifecycle; return [c] }, /缺必填字段 lifecycle/],
    [(c) => { c.consumers = c.allowed_consumers; delete c.allowed_consumers; return [c] }, /不认识的字段 consumers（v2 里叫 allowed_consumers）/],
    [(c) => { c.fact_kind = 'vibe'; return [c] }, /fact_kind 不在取值表里/],
    [(c) => { c.trust_domain = 'renderer'; return [c] }, /trust-domain-mismatch/],
    [(c) => [c, concept({ name: '落家二号', subject: 'catalog.landing-two', owner: { path: 'electron/shared/landing.ts', symbol: 'TIER_KEYS' }, write_api: [{ path: 'electron/shared/landing.ts', symbol: 'TIER_KEYS' }] })], /duplicate-owner/],
    [(c) => { c.migration_status = 'pending'; return [c] }, /pending 概念必须写 migration_strategy/],
    [(c) => { c.write_api = [{ path: 'electron/shared/landing.ts', symbol: 'TIER_KEYS' }]; return [c] }, /owner 必须同时出现在 write_api 里/],
  ]
  for (const [mutate, expected] of cases) {
    const repo = makeRepo()
    try {
      write(repo.root, { [REGISTRY]: registry(mutate(concept())) })
      const red = run(repo)
      assert.equal(red.status, 1, red.output)
      assert.match(red.output, expected)
    } finally {
      cleanup(repo)
    }
  }
})

test('登记表坏掉时是干净的红（点名哪条判据），不是一串堆栈；读不了 JSON 也是红', () => {
  const repo = makeRepo()
  try {
    write(repo.root, { [REGISTRY]: registry([concept({ write_api: { path: 'x' }, forbidden_derivations: 'none', allowed_consumers: {} })]) })
    const broken = run(repo)
    assert.equal(broken.status, 1, broken.output)
    assert.match(broken.output, /write_api 必须是非空数组/)
    assert.match(broken.output, /forbidden_derivations 必须是数组/)
    assert.doesNotMatch(broken.output, /TypeError|at run \(/)

    write(repo.root, { [REGISTRY]: '{ not json' })
    const unreadable = run(repo)
    assert.equal(unreadable.status, 1, unreadable.output)
    assert.match(unreadable.output, /概念 owner 门岗无法开始/)
  } finally {
    cleanup(repo)
  }
})

function pendingConcept(consumers) {
  return concept({
    name: '待决身份',
    subject: 'spend.pending-identity',
    lifecycle: 'spend-authority',
    authority_kind: 'schema',
    fact_kind: 'value-object',
    migration_status: 'pending',
    migration_strategy: '迁到 operationId 之后收口，由测试施工卡负责',
    owner: { path: 'electron/shared/pending.ts', symbol: 'PendingSpend' },
    write_api: [{ path: 'electron/shared/pending.ts', symbol: 'PendingSpend' }],
    forbidden_derivations: [{ symbol: 'mintLegacyGrant', kind: 'reference', why: '按 quoteId 铸令牌的旧路' }],
    allowed_consumers: consumers,
  })
}

const PENDING_FILES = {
  'electron/shared/pending.ts': 'export type PendingSpend = { operationId: string }\n',
  'electron/legacyGrant.ts': 'export function mintLegacyGrant(quoteId: string): string { return quoteId }\n',
  'electron/canvasSpend.ts': "import { mintLegacyGrant } from './legacyGrant'\nexport const grant = mintLegacyGrant('q')\n",
}

test('pending：旧路冻结——例外账里的文件多一扇写门也红；删掉冻结的那扇 → 基线陈旧也红', () => {
  const frozen = { concept: '待决身份', path: 'electron/canvasSpend.ts', symbol: 'mintLegacyGrant' }
  const consumers = ['electron/legacyGrant.ts', 'electron/canvasSpend.ts', 'electron/agentSpend.ts']
  const repo = makeRepo({
    files: { ...PENDING_FILES, 'electron/agentSpend.ts': 'export const agent = 1\n' },
    concepts: [concept(), pendingConcept(consumers)],
    base: baseline({ pending_write_doors: [frozen] }),
  })
  try {
    const green = run(repo)
    assert.equal(green.status, 0, green.output)
    write(repo.root, { 'electron/agentSpend.ts': "import { mintLegacyGrant } from './legacyGrant'\nexport const again = mintLegacyGrant('x')\n" })
    const red = run(repo)
    assert.equal(red.status, 1, red.output)
    assert.match(red.output, /pending-new-write-door/)
    assert.match(red.output, /electron\/agentSpend\.ts · mintLegacyGrant/)
    assert.doesNotMatch(red.output, /pending-unlisted-consumer/, '例外账里的文件不报读者越界，只报旧路新写门')

    write(repo.root, { 'electron/agentSpend.ts': 'export const agent = 1\n', 'electron/canvasSpend.ts': 'export const grant = 1\n' })
    const stale = run(repo)
    assert.equal(stale.status, 1, stale.output)
    assert.match(stale.output, /baseline-stale/)
  } finally {
    cleanup(repo)
  }
})

test('pending：例外账之外的读者也红（暂定主人的接口只许例外账里的文件碰）', () => {
  const frozen = { concept: '待决身份', path: 'electron/canvasSpend.ts', symbol: 'mintLegacyGrant' }
  const repo = makeRepo({
    files: PENDING_FILES,
    concepts: [concept(), pendingConcept(['electron/legacyGrant.ts', 'electron/canvasSpend.ts'])],
    base: baseline({ pending_write_doors: [frozen] }),
  })
  try {
    write(repo.root, { 'src/card.ts': "import type { PendingSpend } from '../electron/shared/pending'\nexport type Card = PendingSpend\n" })
    const red = run(repo)
    assert.equal(red.status, 1, red.output)
    assert.match(red.output, /pending-unlisted-consumer/)
    assert.match(red.output, /src\/card\.ts · PendingSpend/)
  } finally {
    cleanup(repo)
  }
})

const IDENTITY_FILES = {
  'electron/shared/binding.ts': [
    'export function sameBinding(left: { projectId: string; nonce: string }, right: { projectId: string; nonce: string }): boolean {',
    '  return left.projectId === right.projectId && left.nonce === right.nonce',
    '}',
  ].join('\n'),
}

function identityConcept(fields) {
  return concept({
    name: '端口绑定身份',
    subject: 'identity.binding',
    lifecycle: 'session',
    owner: { path: 'electron/shared/binding.ts', symbol: 'sameBinding' },
    write_api: [{ path: 'electron/shared/binding.ts', symbol: 'sameBinding' }],
    identity_fields: fields,
    allowed_consumers: [],
  })
}

test('身份比对（原 check:identity-compare）：登记之外的比对红；维度漂了红；对得上绿', () => {
  const repo = makeRepo({ files: IDENTITY_FILES, concepts: [concept(), identityConcept(['projectId', 'nonce'])] })
  try {
    assert.equal(run(repo).status, 0)
    write(repo.root, {
      'src/copy.ts': 'export const sameCopy = (a: { projectId: string; nonce: string }, b: { projectId: string; nonce: string }) => a.projectId === b.projectId && a.nonce === b.nonce\n',
    })
    const unregistered = run(repo)
    assert.equal(unregistered.status, 1, unregistered.output)
    assert.match(unregistered.output, /identity-comparator/)
    assert.match(unregistered.output, /src\/copy\.ts · sameCopy/)

    write(repo.root, { 'src/copy.ts': null, [REGISTRY]: registry([concept(), identityConcept(['projectId'])]) })
    const drift = run(repo)
    assert.equal(drift.status, 1, drift.output)
    assert.match(drift.output, /identity-drift/)
  } finally {
    cleanup(repo)
  }
})

test('合同：受管合同的共享边界没登记 → 红；登记进写接口 → 绿；早于起点的合同不受管', () => {
  const contract = (symbol) => ({
    schema_version: 3,
    shared_boundaries: [{ path: 'electron/shared/landing.ts', symbol, responsibility: 'test' }],
  })
  const repo = makeRepo({
    files: {
      'electron/shared/landing.ts': `${BASE_FILES['electron/shared/landing.ts']}\nexport function landingDefault(): string { return 'relay' }\n`,
      'docs/fixes/2026-09-20-old.root-cause.json': contract('landingDefault'),
    },
  })
  try {
    assert.equal(run(repo).status, 0, '早于 CONCEPT_OWNERS_SINCE 的合同不受管')
    write(repo.root, { 'docs/fixes/2026-09-29-new.root-cause.json': contract('landingDefault / compareLanding') })
    const red = run(repo)
    assert.equal(red.status, 1, red.output)
    assert.match(red.output, /unregistered-boundary/)
    assert.match(red.output, /electron\/shared\/landing\.ts#landingDefault/)
    assert.doesNotMatch(red.output, /landing\.ts#compareLanding 不是/)

    const registered = concept({
      write_api: [...concept().write_api, { path: 'electron/shared/landing.ts', symbol: 'landingDefault' }],
    })
    write(repo.root, { [REGISTRY]: registry([registered]) })
    const green = run(repo, ['--map'])
    assert.equal(green.status, 0, green.output)
    assert.match(green.output, /2026-09-29-new\.root-cause\.json → 落家/)
  } finally {
    cleanup(repo)
  }
})

test('历史棘轮：已登记概念的第二写口塞进基线 → 红；新登记概念带着现状债进来 → 放行', () => {
  const repo = makeRepo()
  try {
    write(repo.root, {
      'src/dup.ts': 'export function compareLanding(): number { return 0 }\n',
      [BASELINE]: baseline({
        second_write_ports: [{ concept: '落家', path: 'src/dup.ts', symbol: 'compareLanding', reason: '想靠抬基线挤过门岗的那一条' }],
      }),
    })
    const red = run(repo)
    assert.equal(red.status, 1, red.output)
    assert.match(red.output, /baseline-grew/)

    const fresh = concept({
      name: '新概念',
      subject: 'catalog.fresh',
      owner: { path: 'electron/shared/fresh.ts', symbol: 'freshRule' },
      write_api: [{ path: 'electron/shared/fresh.ts', symbol: 'freshRule' }],
      allowed_consumers: [],
    })
    write(repo.root, {
      'src/dup.ts': null,
      'electron/shared/fresh.ts': 'export function freshRule(): number { return 1 }\n',
      'src/freshCopy.ts': 'export function freshRule(): number { return 2 }\n',
      [REGISTRY]: registry([concept(), fresh]),
      [BASELINE]: baseline({
        second_write_ports: [{ concept: '新概念', path: 'src/freshCopy.ts', symbol: 'freshRule', reason: '登记那一刻就存在的第二份，收口前记账' }],
      }),
    })
    const seeded = run(repo)
    assert.equal(seeded.status, 0, seeded.output)
  } finally {
    cleanup(repo)
  }
})

test('概念消失但主人还在 → 红（改名不算：按名字、主人、计数键都认得出）', () => {
  const repo = makeRepo()
  try {
    write(repo.root, { [REGISTRY]: registry([]) })
    const dropped = run(repo)
    assert.equal(dropped.status, 1, dropped.output)
    assert.match(dropped.output, /concept-dropped/)

    write(repo.root, { [REGISTRY]: registry([concept({ name: '落家（改名）' })]) })
    assert.equal(run(repo).status, 0, '同一个主人换了名字仍是同一个概念')
  } finally {
    cleanup(repo)
  }
})

test('--source-ref：拿现在这本账去判历史上的那份代码（先红后绿的复验入口）', () => {
  const repo = makeRepo()
  try {
    write(repo.root, { 'src/config/modelIdentity.ts': "export const TIER_KEYS = new Set(['official'])\n" })
    git(repo.root, 'add', '-A')
    git(repo.root, 'commit', '-q', '-m', 'split owner')
    const splitRef = git(repo.root, 'rev-parse', 'HEAD')
    write(repo.root, { 'src/config/modelIdentity.ts': null })
    git(repo.root, 'add', '-A')
    git(repo.root, 'commit', '-q', '-m', 'converge owner')

    const red = run(repo, ['--source-ref', splitRef, '--concept', 'catalog.landing'])
    assert.equal(red.status, 1, red.output)
    assert.match(red.output, /src\/config\/modelIdentity\.ts:1 · TIER_KEYS/)
    const green = run(repo, ['--source-ref', 'HEAD', '--concept', '落家'])
    assert.equal(green.status, 0, green.output)
  } finally {
    cleanup(repo)
  }
})

test('--concept 点名不存在的概念是红，不是静默跳过', () => {
  const repo = makeRepo()
  try {
    const result = run(repo, ['--concept', '不存在的概念'])
    assert.equal(result.status, 1, result.output)
    assert.match(result.output, /filter-unknown/)
  } finally {
    cleanup(repo)
  }
})

test('parseCatFileBatch 按头里的字节数切内容（多字节中文不错位），missing 记 null', () => {
  const first = Buffer.from('第一份\n')
  const buffer = Buffer.concat([
    Buffer.from(`aaaa blob ${first.length}\n`), first, Buffer.from('\n'),
    Buffer.from('HEAD:gone.ts missing\n'),
  ])
  const parsed = parseCatFileBatch(buffer, ['HEAD:a.ts', 'HEAD:gone.ts'])
  assert.equal(parsed.get('HEAD:a.ts'), '第一份\n')
  assert.equal(parsed.get('HEAD:gone.ts'), null)
})

test('身份比对探测与原门岗同一判据：点号与方括号取维度都算，委托给 owner 的函数隐身', () => {
  const files = {
    'src/a.ts': 'export function matchesX(a: any, b: any) { return a.projectId === b.projectId && a["nonce"] === b["nonce"] }',
    'src/b.ts': 'import { sameBinding } from "./owner"\nexport function sameY(a: any, b: any) { return sameBinding(a, b) }',
    'src/c.test.ts': 'export function sameZ(a: any, b: any) { return a.projectId === b.projectId && a.nonce === b.nonce }',
  }
  const found = findIdentityComparators({ files: Object.keys(files), read: (file) => files[file] })
  assert.deepEqual(found, [{ path: 'src/a.ts', symbol: 'matchesX', dimensions: ['nonce', 'projectId'] }])
})

test('trust_domain 由路径派生', () => {
  assert.equal(trustDomainOfPath('electron/shared/x.ts'), 'shared')
  assert.equal(trustDomainOfPath('electron/preload.ts'), 'preload')
  assert.equal(trustDomainOfPath('electron/x.ts'), 'main')
  assert.equal(trustDomainOfPath('src/x.ts'), 'renderer')
  assert.equal(trustDomainOfPath('tests/ux/_paidRun.mjs'), 'test')
  assert.equal(trustDomainOfPath('scripts/x.mjs'), 'tooling')
  assert.equal(trustDomainOfPath('worker/byteRange.ts'), 'site')
  assert.equal(trustDomainOfPath('wrangler.json'), 'site')
})

test('未登记的合同边界冻结成存量债棘轮：冻结的放行；新增 → 红；登记 / 合同删了而基线还留着 → 陈旧红；基线往上抬 → 红', () => {
  const contract = (symbol) => ({
    schema_version: 3,
    shared_boundaries: [{ path: 'electron/shared/landing.ts', symbol, responsibility: 'test' }],
  })
  const frozen = { contract: 'docs/fixes/2026-09-29-new.root-cause.json', path: 'electron/shared/landing.ts', symbol: 'landingDefault' }
  const repo = makeRepo({
    files: {
      'electron/shared/landing.ts': `${BASE_FILES['electron/shared/landing.ts']}\nexport function landingDefault(): string { return 'relay' }\nexport function landingOther(): string { return 'x' }\n`,
      'docs/fixes/2026-09-29-new.root-cause.json': contract('landingDefault'),
    },
    base: baseline({ unregistered_boundaries: [frozen] }),
  })
  try {
    const green = run(repo)
    assert.equal(green.status, 0, green.output)
    assert.match(green.output, /冻结在基线/)
    // 新增一处未登记的边界：红，并写明「新增」
    write(repo.root, { 'docs/fixes/2026-09-30-more.root-cause.json': contract('landingOther') })
    const red = run(repo)
    assert.equal(red.status, 1, red.output)
    assert.match(red.output, /landingOther/)
    assert.match(red.output, /新增：不在冻结的存量债里/)
    // 还原后变绿
    write(repo.root, { 'docs/fixes/2026-09-30-more.root-cause.json': null })
    assert.equal(run(repo).status, 0)
    // 合同删了、基线还冻着它：陈旧红
    write(repo.root, { 'docs/fixes/2026-09-29-new.root-cause.json': null })
    const stale = run(repo)
    assert.equal(stale.status, 1, stale.output)
    assert.match(stale.output, /baseline-stale/)
    write(repo.root, { 'docs/fixes/2026-09-29-new.root-cause.json': contract('landingDefault') })
    // 基线往上抬（把新边界塞进冻结账）：对照参照提交 → baseline-grew
    write(repo.root, {
      'docs/fixes/2026-09-30-more.root-cause.json': contract('landingOther'),
      [BASELINE]: baseline({ unregistered_boundaries: [frozen, { ...frozen, contract: 'docs/fixes/2026-09-30-more.root-cause.json', symbol: 'landingOther' }] }),
    })
    const grew = run(repo)
    assert.equal(grew.status, 1, grew.output)
    assert.match(grew.output, /baseline-grew/)
  } finally {
    cleanup(repo)
  }
})
