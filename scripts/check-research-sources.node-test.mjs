/**
 * 调研来源门岗的自测：**先证明它会红**（R17），再证明它不乱红。
 *
 * 一道从没红过的门岗和一道不存在的门岗，在 CI 输出里长得一模一样。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { inspectContent, isResearchTitle, scanResearchDocs } from './check-research-sources.mjs'

/** 夹具根目录；路径身份相对它自己算，断言才读得懂。 */
function fixtureRoot(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-sources-'))
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  return dir
}

const COMPLIANT = `# 某某调研

## 2. 一手来源

### 2.3 自媒体来源（TikHub）

产物：\`docs/research/2026-09-07-x/tikhub/tikhub-search.md\`
`

test('阳性对照：调研文档缺整节 → 报出来', () => {
  const root = fixtureRoot({ 'a.md': '# 某某调研\n\n## 结论\n\n没有自媒体那一节。\n' })
  const { checked, violations } = scanResearchDocs(root, { relativeTo: root })
  assert.deepEqual(checked.length, 1)
  assert.equal(violations.length, 1)
  assert.ok(violations[0].reasons.some((reason) => reason.includes('自媒体来源')))
  assert.ok(violations[0].reasons.some((reason) => reason.includes('tikhub')))
})

test('阳性对照：有节但没引用 tikhub 附件 → 仍然报', () => {
  const root = fixtureRoot({ 'a.md': '# 某某调研\n\n### 自媒体来源\n\n我在小红书上随手翻了翻。\n' })
  const { violations } = scanResearchDocs(root, { relativeTo: root })
  assert.equal(violations.length, 1)
  assert.deepEqual(violations[0].reasons, ['没引用 tikhub 附件（docs/research/<date>-<topic>/tikhub/）'])
})

test('合规文档不报', () => {
  const root = fixtureRoot({ 'a.md': COMPLIANT })
  const { checked, violations } = scanResearchDocs(root, { relativeTo: root })
  assert.equal(checked.length, 1)
  assert.deepEqual(violations, [])
})

test('明写「本次没用 TikHub，因为 X」也算达标——门岗是提醒不是逼人写假的', () => {
  const root = fixtureRoot({
    'a.md': '# 某某调研\n\n### 2.3 自媒体来源\n\n本次没用 TikHub：纯内部构建链问题，自媒体上不会有信号。\n',
  })
  assert.deepEqual(scanResearchDocs(root, { relativeTo: root }).violations, [])
})

test('只管标题自称调研/research 的文档', () => {
  assert.equal(isResearchTitle('Nomi 创作区 Agent 模式调研与改造方案'), true)
  assert.equal(isResearchTitle('Video Agent Research Notes'), true)
  assert.equal(isResearchTitle('画布结构链真走查审计'), false)
  const root = fixtureRoot({ 'a.md': '# 某某审计\n\n跟调研无关。\n' })
  assert.deepEqual(scanResearchDocs(root, { relativeTo: root }), { checked: [], violations: [] })
})

test('每日论文雷达豁免：它的信息面是 arxiv，不是某个问题的调研', () => {
  const root = fixtureRoot({ '2026-09-06-radar.md': '# Nomi Research Radar — 2026-09-06\n\n无自媒体一节。\n' })
  assert.deepEqual(scanResearchDocs(root, { relativeTo: root }), { checked: [], violations: [] })
})

test('子目录里的调研文档一样扫得到', () => {
  const root = fixtureRoot({ '2026-09-07-topic/README.md': '# 子包调研\n\n没有那一节。\n' })
  const { violations } = scanResearchDocs(root, { relativeTo: root })
  assert.equal(violations.length, 1)
  assert.equal(violations[0].file, '2026-09-07-topic/README.md')
})

test('标题只在开头若干行里找', () => {
  const padded = `${'\n'.repeat(60)}# 某某调研\n\n### 自媒体来源\n\ntikhub\n`
  assert.equal(inspectContent(padded).title, '')
  assert.equal(inspectContent(COMPLIANT).title, '某某调研')
})

test('仓库真实基线里的每条路径都还存在——基线不许留幽灵条目', () => {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
  const baseline = JSON.parse(fs.readFileSync(path.join(repoRoot, 'scripts', 'research-sources-baseline.json'), 'utf8'))
  for (const file of baseline.documentsWithoutSocialSources) {
    assert.ok(fs.existsSync(path.join(repoRoot, file)), `基线里的 ${file} 已经不存在了`)
  }
})
