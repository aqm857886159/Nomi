// 概念登记（docs/engineering/concept-owners/，一个概念一个文件）的唯一加载函数（2026-10-07）。
//
// 为什么拆：原来是一个大 JSON（concepts[]），几乎每个修复 PR 都往末尾追加一个概念，并行 PR 必然互相 CONFLICTING。
// 现在：`<目录>/<subject>.json` 一个概念一个文件；顶层字段（_schema、schema_version）在 `_meta.json`。
// 判据（字段表、写口、棘轮）照旧全在 scripts/concept-owners-lib.mjs，本文件只管「从哪读、文件名怎么对」，
// 不 import 判据层（那边连着 typescript 的 AST 扫描，fix-churn / capability-index 这些轻量读者不该背它）。
import path from 'node:path'

import { readEntryDirectory, readEntryDirectoryAtRef, refuseRetiredFile } from './lib/entryDirectory.mjs'

export const CONCEPT_OWNERS_DIR = 'docs/engineering/concept-owners'
/** 拆分前的大文件：墓碑，不是读口（见 lib/entryDirectory.mjs 的 refuseRetiredFile）。在途 PR 都合完后一起删。 */
export const RETIRED_CONCEPT_OWNERS_FILE = 'docs/engineering/concept-owners.json'
/**
 * 文件名就是 subject（不转义）。subject 本来就只许点分的小写标识（字段表 R33.4），没有 `/`、没有大写，
 * 所以 subject ↔ 文件名天然一一对应、大小写不敏感的文件系统上也不会撞，而且 grep subject 就能找到文件。
 * concept-owners-lib 的字段判据直接用这一条（只此一份）。
 */
export const CONCEPT_SUBJECT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/

/** subject → 文件名。subject 不合法直接抛错：一个没法落成文件名的 subject 不能悄悄改名落盘。 */
export function conceptFileName(subject) {
  if (!CONCEPT_SUBJECT_PATTERN.test(String(subject ?? ''))) throw new Error(`概念 subject 必须是点分的小写标识（它就是文件名）：${subject}`)
  return `${subject}.json`
}

/** 文件名 → subject；不是概念文件（含 _meta.json）→ null。 */
export function subjectOfFileName(name) {
  if (!String(name ?? '').endsWith('.json')) return null
  const subject = name.slice(0, -'.json'.length)
  return CONCEPT_SUBJECT_PATTERN.test(subject) ? subject : null
}

/** 目录内容 → 与原大文件同形的登记表 `{ ...meta, concepts }`（按 subject 排序）；文件名和 subject 对不上就抛错。 */
export function assembleConceptRegistry(directory) {
  const problems = []
  for (const { name, value } of directory.entries) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) problems.push(`${name}：一个文件必须是一个概念（对象）`)
    else if (subjectOfFileName(name) !== value.subject) problems.push(`${name}：文件名必须是「<subject>.json」，这个概念的 subject 是 ${JSON.stringify(value.subject)}`)
  }
  if (problems.length) throw new Error(`${CONCEPT_OWNERS_DIR} 的概念文件不对：${problems.join('；')}`)
  const concepts = directory.entries.map((entry) => entry.value).sort((left, right) => left.subject.localeCompare(right.subject))
  return { ...directory.meta, concepts }
}

/**
 * 唯一加载函数：工作树（不给 ref）或某个提交上的概念登记 → `{ _schema, schema_version, concepts }`。
 * 目录不存在 → null；文件坏了 / 文件名不对 → 抛错（门岗读到坏登记必须红）。
 */
export function loadConceptRegistry(repoRoot, { ref = null } = {}) {
  if (!ref) refuseRetiredFile(repoRoot, RETIRED_CONCEPT_OWNERS_FILE)
  const directory = ref
    ? readEntryDirectoryAtRef(repoRoot, ref, CONCEPT_OWNERS_DIR)
    : readEntryDirectory(path.join(repoRoot, CONCEPT_OWNERS_DIR))
  return directory ? assembleConceptRegistry(directory) : null
}
