import { makeTempDir } from './_test-temp.mjs'
// 「一条一个文件」的账本目录（scripts/lib/entryDirectory.mjs）与两本账本的唯一加载函数：
// 文件名 ↔ 身份一一对应、读某个提交 = 读工作树、坏文件点名、旧大文件留在工作树里就拒绝（墓碑）。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  CONCEPT_OWNERS_DIR,
  CONCEPT_SUBJECT_PATTERN,
  RETIRED_CONCEPT_OWNERS_FILE,
  conceptFileName,
  loadConceptRegistry,
  subjectOfFileName,
} from './concept-registry-lib.mjs'
import { ESCAPE_LEDGER_DIR, RETIRED_ESCAPE_LEDGER_FILE, loadEscapeLedger } from './escape-ledger-lib.mjs'
import { META_FILE, formatEntryJson, readEntryDirectory } from './lib/entryDirectory.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function tempRepo(t) {
  const root = makeTempDir('entry-directory-')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

const git = (root, ...args) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' })

function writeConcepts(root, concepts, meta = { _schema: 'test', schema_version: 2 }) {
  const dir = path.join(root, CONCEPT_OWNERS_DIR)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, META_FILE), formatEntryJson(meta))
  for (const concept of concepts) fs.writeFileSync(path.join(dir, conceptFileName(concept.subject)), formatEntryJson(concept))
}

test('真实概念登记：每个文件名都恰好是 <subject>.json，subject ↔ 文件名一一对应', () => {
  const directory = readEntryDirectory(path.join(repoRoot, CONCEPT_OWNERS_DIR))
  assert.ok(directory.entries.length > 100, '登记表读到了')
  const subjects = new Set()
  for (const { name, value } of directory.entries) {
    assert.equal(name, conceptFileName(value.subject), name)
    assert.equal(subjectOfFileName(name), value.subject, name)
    subjects.add(value.subject)
  }
  assert.equal(subjects.size, directory.entries.length, 'subject 不重复')
  assert.deepEqual(Object.keys(directory.meta).sort(), ['_schema', 'schema_version'])
  const registry = loadConceptRegistry(repoRoot)
  assert.deepEqual(registry.concepts.map((concept) => concept.subject), [...subjects].sort(), '按 subject 排序（码位序）')
})

test('真实逃逸账本：顶层字段都在 _meta.json，条目按 since + id 排序', () => {
  const ledger = loadEscapeLedger(repoRoot)
  assert.deepEqual(Object.keys(ledger), ['$schemaVersion', '_doc', 'statusValues', 'categories', 'entries'])
  const keys = ledger.entries.map((entry) => `${entry.since} ${entry.id}`)
  assert.deepEqual(keys, [...keys].sort((a, b) => {
    const [sinceA, idA] = a.split(' ')
    const [sinceB, idB] = b.split(' ')
    return sinceA < sinceB ? -1 : sinceA > sinceB ? 1 : idA < idB ? -1 : idA > idB ? 1 : 0
  }))
})

test('文件名规则：只认点分小写 subject；/、大写、单段、_meta 都不是概念文件', () => {
  assert.equal(conceptFileName('production.shot-phase'), 'production.shot-phase.json')
  for (const bad of ['Production.shot', 'production/shot', 'production', '../x.y', '']) {
    assert.throws(() => conceptFileName(bad), /点分的小写标识/, bad)
    assert.equal(CONCEPT_SUBJECT_PATTERN.test(bad), false, bad)
  }
  assert.equal(subjectOfFileName(META_FILE), null)
  assert.equal(subjectOfFileName('production.shot-phase.txt'), null)
})

test('概念登记：文件名和 subject 对不上 / 没有 subject / 文件坏了 / 缺 _meta → 抛错点名；目录不在 → null', (t) => {
  const root = tempRepo(t)
  assert.equal(loadConceptRegistry(root), null)
  const concept = { name: '甲', subject: 'catalog.alpha' }
  writeConcepts(root, [concept])
  assert.deepEqual(loadConceptRegistry(root), { _schema: 'test', schema_version: 2, concepts: [concept] })

  fs.writeFileSync(path.join(root, CONCEPT_OWNERS_DIR, 'catalog.beta.json'), formatEntryJson({ name: '乙', subject: 'catalog.gamma' }))
  assert.throws(() => loadConceptRegistry(root), /catalog\.beta\.json：文件名必须是「<subject>\.json」/)

  writeConcepts(root, [concept])
  fs.writeFileSync(path.join(root, CONCEPT_OWNERS_DIR, 'catalog.beta.json'), formatEntryJson({ name: '乙' }))
  assert.throws(() => loadConceptRegistry(root), /catalog\.beta\.json/)

  writeConcepts(root, [concept])
  fs.writeFileSync(path.join(root, CONCEPT_OWNERS_DIR, 'catalog.beta.json'), '{ nope')
  assert.throws(() => loadConceptRegistry(root), /catalog\.beta\.json 不是合法 JSON/)

  writeConcepts(root, [concept])
  fs.rmSync(path.join(root, CONCEPT_OWNERS_DIR, META_FILE))
  assert.throws(() => loadConceptRegistry(root), /_meta\.json 不存在/)
})

test('读某个提交 = 读工作树（同一份组装）；那个提交上没有目录 → null', (t) => {
  const root = tempRepo(t)
  writeConcepts(root, [{ name: '乙', subject: 'catalog.beta' }, { name: '甲', subject: 'catalog.alpha' }])
  git(root, 'init', '-q')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'registry')
  const loaded = loadConceptRegistry(root)
  assert.deepEqual(loaded.concepts.map((concept) => concept.subject), ['catalog.alpha', 'catalog.beta'])
  assert.deepEqual(loadConceptRegistry(root, { ref: 'HEAD' }), loaded)
  git(root, 'rm', '-q', '-r', CONCEPT_OWNERS_DIR)
  git(root, 'commit', '-q', '-m', 'drop')
  assert.equal(loadConceptRegistry(root, { ref: 'HEAD' }), null)
  assert.throws(() => loadConceptRegistry(root, { ref: 'no-such-ref' }), /读不到提交/)
})

test('墓碑：工作树里还留着拆分前的大文件 → 两个加载函数都拒绝（合 main 时留下它，里面新加的条目会悄悄不进账）', (t) => {
  const root = tempRepo(t)
  writeConcepts(root, [{ name: '甲', subject: 'catalog.alpha' }])
  fs.mkdirSync(path.join(root, ESCAPE_LEDGER_DIR), { recursive: true })
  fs.writeFileSync(path.join(root, ESCAPE_LEDGER_DIR, META_FILE), formatEntryJson({ $schemaVersion: 1 }))
  assert.ok(loadConceptRegistry(root))
  assert.ok(loadEscapeLedger(root))
  fs.writeFileSync(path.join(root, RETIRED_CONCEPT_OWNERS_FILE), '{}')
  fs.writeFileSync(path.join(root, RETIRED_ESCAPE_LEDGER_FILE), '{}')
  assert.throws(() => loadConceptRegistry(root), /concept-owners\.json 已拆成一条一个文件的目录/)
  assert.throws(() => loadEscapeLedger(root), /escapeLedger\.json 已拆成一条一个文件的目录/)
  assert.equal(fs.existsSync(path.join(repoRoot, RETIRED_CONCEPT_OWNERS_FILE)), false, '仓库里旧大文件已删')
  assert.equal(fs.existsSync(path.join(repoRoot, RETIRED_ESCAPE_LEDGER_FILE)), false, '仓库里旧大文件已删')
})
