/**
 * 自动补齐的阳性对照（R17）：先造出一个「门岗会红」的仓库快照，再证明补齐把它变绿，
 * 而且**只碰新增的那几篇**——基线里冻着的历史存量一根手指都不许动（碰了就等于偷偷抬基线）。
 *
 * 判据用的是门岗自己的扫描库（docs-index-lib / doc-status-lib），不是另写一份近似判断：
 * 「补齐脚本认为补好了、门岗认为还没有」是这类自动化最典型的死法。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { scanDocumentIndex } from './docs-index-lib.mjs'
import { documentStatus } from './doc-status-lib.mjs'
import { AUTO_INDEX_HEADING, indexOwnerFor, insertStatusLine, repairDocGates } from './repair-doc-gates.mjs'

function write(root, relativePath, content) {
  const file = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

/** 一个最小仓库快照：两篇冻在基线里的存量 + 两篇「刚加的」违规文档。 */
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-autosync-'))
  write(root, 'scripts/docs-index-baseline.json', JSON.stringify({
    unindexedDocuments: ['docs/plan/legacy-unindexed.md'],
  }))
  write(root, 'scripts/doc-status-baseline.json', JSON.stringify({
    missingStatus: ['docs/plan/legacy-unindexed.md', 'docs/plan/legacy-nostatus.md'],
    deprecatedWithoutReplacement: [],
  }))
  write(root, 'docs/README.md', '# docs\n')
  write(root, 'docs/plan/INDEX.md', '# docs/plan 索引地图\n\n| 文件 | 状态 |\n|---|---|\n| [legacy-nostatus.md](legacy-nostatus.md) | |\n')
  write(root, 'docs/lessons/INDEX.md', '# 教训索引\n\n## A. 场景\n\n- [old-lesson](old-lesson.md) — 旧的\n')
  write(root, 'docs/plan/legacy-unindexed.md', '# 历史存量：没进索引也没状态\n\n正文。\n')
  write(root, 'docs/plan/legacy-nostatus.md', '# 历史存量：进了索引但没状态\n\n正文。\n')
  write(root, 'docs/lessons/old-lesson.md', '# 旧教训\n\n正文。\n')
  // —— 这两篇是「本次新增」，门岗会为它们报红 ——
  write(root, 'docs/plan/2026-09-05-new-plan.md', '# 新方案\n\n正文。\n')
  write(root, 'docs/lessons/new-lesson.md', '# 新教训\n\n正文。\n')
  return root
}

test('补齐前门岗确实会红，补齐后变绿（且只动新增那两篇）', () => {
  const root = fixture()

  // ① 阳性对照：补齐之前，两篇新增文档在门岗判据下都是违规。
  const before = scanDocumentIndex(root)
  assert.ok(before.unindexed.includes('docs/plan/2026-09-05-new-plan.md'))
  assert.ok(before.unindexed.includes('docs/lessons/new-lesson.md'))
  assert.equal(documentStatus(fs.readFileSync(path.join(root, 'docs/plan/2026-09-05-new-plan.md'), 'utf8')).status, null)

  const result = repairDocGates({ repoRoot: root, regenerateLedger: false })

  // ② 补齐后：索引判据里不再有这两篇（= check:docs-index 的 added 为空）。
  const after = scanDocumentIndex(root)
  assert.ok(!after.unindexed.includes('docs/plan/2026-09-05-new-plan.md'))
  assert.ok(!after.unindexed.includes('docs/lessons/new-lesson.md'))
  assert.deepEqual(result.indexed.sort(), ['docs/lessons/new-lesson.md', 'docs/plan/2026-09-05-new-plan.md'])
  assert.deepEqual(result.unrepairable, [])

  // 状态标记：只给新增那篇盖章，且盖的是「待拍板」，不是猜一个进行中。
  assert.deepEqual(result.statusMarked, ['docs/plan/2026-09-05-new-plan.md'])
  const marked = fs.readFileSync(path.join(root, 'docs/plan/2026-09-05-new-plan.md'), 'utf8')
  assert.equal(documentStatus(marked).status, '📋')
  assert.match(marked, /^# 新方案$/m)

  // ③ 存量一根手指都不许动：还是没状态、还是没进索引。
  assert.equal(documentStatus(fs.readFileSync(path.join(root, 'docs/plan/legacy-nostatus.md'), 'utf8')).status, null)
  assert.ok(after.unindexed.includes('docs/plan/legacy-unindexed.md'))

  // 自动区标注清楚是机器补的、待人工归位。
  const planIndex = fs.readFileSync(path.join(root, 'docs/plan/INDEX.md'), 'utf8')
  assert.match(planIndex, new RegExp(AUTO_INDEX_HEADING))
  assert.match(planIndex, /\]\(2026-09-05-new-plan\.md\)/)

  // ④ 幂等：再跑一遍什么都不做，产物逐字节不变（否则 main 上每次 push 都会 commit 一次）。
  const snapshot = fs.readFileSync(path.join(root, 'docs/plan/INDEX.md'), 'utf8')
  const again = repairDocGates({ repoRoot: root, regenerateLedger: false })
  assert.deepEqual(again.indexed, [])
  assert.deepEqual(again.statusMarked, [])
  assert.equal(fs.readFileSync(path.join(root, 'docs/plan/INDEX.md'), 'utf8'), snapshot)

  fs.rmSync(root, { recursive: true, force: true })
})

test('补不了的文档报红，不静默放过', () => {
  const root = fixture()
  write(root, 'scripts/docs-index-baseline.json', JSON.stringify({ unindexedDocuments: [] }))
  write(root, 'docs/superpowers/plans/2026-09-05-orphan.md', '# 孤儿总纲\n\n> 📋 方案待拍板\n\n正文。\n')
  const result = repairDocGates({ repoRoot: root, regenerateLedger: false })
  // superpowers/plans 的索引是生成物，本脚本不追加行——它必须显式报「补不了」，
  // 而不是当作补好了（那样 main 上的验证步骤会红得莫名其妙）。
  assert.ok(result.unrepairable.includes('docs/superpowers/plans/2026-09-05-orphan.md'))
  assert.equal(indexOwnerFor('docs/superpowers/plans/2026-09-05-orphan.md'), null)
  fs.rmSync(root, { recursive: true, force: true })
})

test('没有 H1 的文档也能拿到状态标记，且落在生效窗口内', () => {
  const source = '正文第一行，没有标题。\n\n更多正文。\n'
  const patched = insertStatusLine(source)
  assert.equal(documentStatus(patched).status, '📋')
  assert.ok(patched.split('\n').indexOf('正文第一行，没有标题。') > 0)
})
