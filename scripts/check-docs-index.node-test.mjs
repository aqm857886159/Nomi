import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { cleanupTestTemp, makeTempDir } from './_test-temp.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const planIndexPath = path.join(repoRoot, 'docs', 'plan', 'INDEX.md')
const planFilePath = path.join(repoRoot, 'docs', 'plan', '2026-09-04-cross-device-min-energy-redesign.md')
const planPath = '2026-09-04-cross-device-min-energy-redesign.md'

test('indexes the cross-device minimum-energy redesign plan', () => {
  const index = fs.readFileSync(planIndexPath, 'utf8')
  assert.ok(index.includes(`](${planPath})`), `docs/plan/INDEX.md must link ${planPath}`)
})

test('marks the cross-device minimum-energy redesign plan with a status', () => {
  const opening = fs.readFileSync(planFilePath, 'utf8').split(/\r?\n/).slice(0, 12).join('\n')
  assert.match(opening, /✅|🚧|⏳|🧊|📋|⛔|📎/, `${planPath} must declare a status in its opening 12 lines`)
})

test('dead image embeds: relative targets must exist; external links, code spans and fenced code are ignored', async () => {
  const { findDeadImageEmbeds } = await import('./docs-index-lib.mjs')
  const root = makeTempDir('docs-dead-img-')
  try {
    fs.mkdirSync(path.join(root, 'docs', 'a'), { recursive: true })
    fs.writeFileSync(path.join(root, 'docs', 'a', 'ok.png'), 'x')
    fs.writeFileSync(path.join(root, 'docs', 'a', 'doc.md'), [
      '![有](ok.png)',
      '![根路径有](/docs/a/ok.png)',
      '![死](gone.png)',
      '![死带标题](<sub/gone 2.png> "t")',
      '![外链](https://example.com/x.png)',
      '![data](data:image/png;base64,AAAA)',
      '行内 `![](nope.png)` 不算',
      '```',
      '![](also-nope.png)',
      '```',
    ].join('\n'))
    const dead = findDeadImageEmbeds(root, ['docs/a/doc.md'])
    assert.deepEqual(dead, [
      { doc: 'docs/a/doc.md', target: 'docs/a/gone.png' },
      { doc: 'docs/a/doc.md', target: 'docs/a/sub/gone 2.png' },
    ])
  } finally {
    cleanupTestTemp(root)
  }
})

test('the whole repo has zero dead image embeds (baseline 0)', async () => {
  const { findDeadImageEmbeds, listTrackedMarkdown } = await import('./docs-index-lib.mjs')
  assert.deepEqual(findDeadImageEmbeds(repoRoot, listTrackedMarkdown(repoRoot)), [])
})
