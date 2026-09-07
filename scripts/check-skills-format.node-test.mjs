// 门岗自己的测试（R17：加规则必须先验它会红）。喂假技能包，一条规则一对阴阳样本——
// 只跑真目录的话，明天新写坏一个技能它红不红是没被测过的。
import assert from 'node:assert/strict'
import test from 'node:test'

import { ALLOWED_TOP_LEVEL_FIELDS, checkSkillDirectory, extractFrontmatter } from './skills-format-lib.mjs'

const good = (extra = '') => ({
  'SKILL.md': `---\nname: demo-skill\ndescription: 一个用来测门岗的技能。${extra ? `\n${extra}` : ''}\n---\n\n# 正文\n`,
})
const rules = (errors) => errors.map((error) => error.rule).sort()

test('合规的技能包不报任何错', () => {
  assert.deepEqual(checkSkillDirectory('demo-skill', good()), [])
})

test('F1：目录里还有 skill.json 就红', () => {
  const files = { ...good(), 'skill.json': '{"name":"demo-skill"}' }
  assert.deepEqual(rules(checkSkillDirectory('demo-skill', files)), ['F1'])
})

test('F1：子目录里的 skill.json 也算', () => {
  const files = { ...good(), 'references/skill.json': '{}' }
  assert.deepEqual(rules(checkSkillDirectory('demo-skill', files)), ['F1'])
})

test('F2：缺 SKILL.md 就红', () => {
  assert.deepEqual(rules(checkSkillDirectory('demo-skill', {})), ['F2'])
})

test('F2：没有 frontmatter 就红', () => {
  assert.deepEqual(rules(checkSkillDirectory('demo-skill', { 'SKILL.md': '# 只有正文\n' })), ['F2'])
})

test('F2：description 里未加引号的 ": " 就红（main 上 director-art-design 的真实形状）', () => {
  const files = {
    'SKILL.md': '---\nname: demo-skill\ndescription: 为视觉 anchor（`carrier: visual`）写提示词。\n---\n\n# 正文\n',
  }
  assert.deepEqual(rules(checkSkillDirectory('demo-skill', files)), ['F2'])
})

test('F2：同一句加了引号就绿——证明红的是格式不是内容', () => {
  const files = {
    'SKILL.md': '---\nname: demo-skill\ndescription: "为视觉 anchor（`carrier: visual`）写提示词。"\n---\n\n# 正文\n',
  }
  assert.deepEqual(checkSkillDirectory('demo-skill', files), [])
})

test('F3：点号分段的 name 就红（main 上 30 个技能的真实形状）', () => {
  const files = { 'SKILL.md': '---\nname: director.art-design\ndescription: 测试。\n---\n\n# 正文\n' }
  // 两条：不合字符规范 + 与目录名不一致。
  assert.deepEqual(rules(checkSkillDirectory('director-art-design', files)), ['F3', 'F3'])
})

test('F3：name 与目录名不一致就红', () => {
  const files = { 'SKILL.md': '---\nname: other-skill\ndescription: 测试。\n---\n\n# 正文\n' }
  assert.deepEqual(rules(checkSkillDirectory('demo-skill', files)), ['F3'])
})

test('F3：缺 name 或 description 就红', () => {
  const noName = { 'SKILL.md': '---\ndescription: 测试。\n---\n\n# 正文\n' }
  const noDescription = { 'SKILL.md': '---\nname: demo-skill\n---\n\n# 正文\n' }
  assert.deepEqual(rules(checkSkillDirectory('demo-skill', noName)), ['F3'])
  assert.deepEqual(rules(checkSkillDirectory('demo-skill', noDescription)), ['F3'])
})

test('F3：超长的 name / description 就红', () => {
  const longName = `d${'e'.repeat(64)}`
  const files = {
    'SKILL.md': `---\nname: ${longName}\ndescription: 测试。\n---\n\n# 正文\n`,
  }
  assert.ok(rules(checkSkillDirectory(longName, files)).includes('F3'))
  const longDescription = {
    'SKILL.md': `---\nname: demo-skill\ndescription: "${'字'.repeat(1025)}"\n---\n\n# 正文\n`,
  }
  assert.deepEqual(rules(checkSkillDirectory('demo-skill', longDescription)), ['F3'])
})

test('F4：Nomi 私有字段写在顶层就红（收敛前 audience 就在那儿）', () => {
  assert.deepEqual(rules(checkSkillDirectory('demo-skill', good('audience: mcp'))), ['F4'])
})

test('F4：同一个字段搬进 metadata.nomi 就绿', () => {
  const files = {
    'SKILL.md': '---\nname: demo-skill\ndescription: 测试。\nmetadata:\n  nomi:\n    audience: mcp\n    stages:\n      - id: script\n        goal: 写剧本\n---\n\n# 正文\n',
  }
  assert.deepEqual(checkSkillDirectory('demo-skill', files), [])
})

test('F4：规范闭集里的可选字段照收，disable-model-invocation 也照收', () => {
  const files = {
    'SKILL.md': '---\nname: demo-skill\ndescription: 测试。\nlicense: Proprietary\ncompatibility: Nomi desktop\nallowed-tools: read\ndisable-model-invocation: true\n---\n\n# 正文\n',
  }
  assert.deepEqual(checkSkillDirectory('demo-skill', files), [])
  assert.ok(ALLOWED_TOP_LEVEL_FIELDS.includes('disable-model-invocation'))
})

test('F4：metadata 不是映射就红', () => {
  const files = { 'SKILL.md': '---\nname: demo-skill\ndescription: 测试。\nmetadata: 一句话\n---\n\n# 正文\n' }
  assert.deepEqual(rules(checkSkillDirectory('demo-skill', files)), ['F4'])
})

test('extractFrontmatter：没有 frontmatter 时返回 null，CRLF 与 BOM 不影响', () => {
  assert.equal(extractFrontmatter('# 只有正文'), null)
  assert.equal(extractFrontmatter('﻿---\r\nname: a\r\n---\r\n正文'), 'name: a')
})
