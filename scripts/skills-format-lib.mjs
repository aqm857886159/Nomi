// 技能格式门岗的判据本体（R17：判据住在 lib 里，才喂得进假仓库验「它会不会红」）。
//
// 守的不变量：**一个技能包只有一份清单，就是 SKILL.md 的 YAML frontmatter，而且它得是别人
// 也能读的那一份。** 2026-09-07 之前 Nomi 多一份 `skill.json`，两份还会漂（同一个技能的
// description 在两处不一样，模型在 Nomi 里和在 pi 里听到的自我介绍不同）。
//
// 判据分两类，刻意分开：
//   · F1–F4 是**我们自己能判的**：没有 skill.json、frontmatter 是合法 YAML、必填字段合规、
//     顶层键在规范闭集内。
//   · F6 是**让别人判**：直接调 pi 自带的加载器扫一遍 skills/，要求「一个不少、零 diagnostics」。
//     这条才是真正防「我们的解析器比别人宽松，所以看不见问题」那一族——2026-09-07 实测
//     main 上是 32/33 + 31 条警告，其中一个技能因为 description 里有个未加引号的 `: `
//     在 pi / Claude Code / Codex 里**整包读不出来**，而我们自己的正则解析器毫无察觉。
//   （F5「metadata.nomi 通过 Nomi 的 zod schema」不在这里：它需要 TypeScript 侧的 schema，
//     住在 electron/skills/builtinSkills.test.ts，一个语义一个 owner。）
//
// 顶层键白名单 = Agent Skills 规范闭集 ∪ {disable-model-invocation}。规范的参考校验器
// （agentskills/skills-ref 的 validator.py:104-115）对顶层做闭集校验，多一个就是 error；
// 而 `disable-model-invocation` 虽然不在那个闭集里，pi（dist/core/skills.js:262）与 Claude Code
// 都原生支持它，挪走反而会让那两家读不到。这是一处有意偏离，理由写在这里而不是散在代码里。
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'

/** Agent Skills 规范的顶层字段闭集（https://agentskills.io/specification）。 */
export const SPEC_TOP_LEVEL_FIELDS = Object.freeze([
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
])
/** 有意偏离：规范闭集之外我们额外允许的顶层键（理由见文件头）。 */
export const NOMI_EXTRA_TOP_LEVEL_FIELDS = Object.freeze(['disable-model-invocation'])
export const ALLOWED_TOP_LEVEL_FIELDS = Object.freeze([
  ...SPEC_TOP_LEVEL_FIELDS,
  ...NOMI_EXTRA_TOP_LEVEL_FIELDS,
])

export const MAX_NAME_LENGTH = 64
export const MAX_DESCRIPTION_LENGTH = 1024
/** 规范：1-64 字符，仅小写 a-z / 0-9 / 连字符，不得首尾连字符，不得连续连字符。 */
export const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** 切出 frontmatter 原文；没有 `---` 开头就返回 null（= 没有 frontmatter）。 */
export function extractFrontmatter(source) {
  const normalized = String(source).replace(/^﻿/, '').replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---')) return null
  const end = normalized.indexOf('\n---', 3)
  if (end === -1) return null
  return normalized.slice(4, end)
}

/**
 * 校验一个技能目录。`files` 是 `{ 相对路径: 内容 }`，由调用方从磁盘或假仓库喂进来
 * ——门岗自己的测试要能造出「恢复了 skill.json 的那个仓库」，不能只跑真目录。
 */
export function checkSkillDirectory(dirName, files) {
  const errors = []
  const fail = (rule, message) => errors.push({ rule, dirName, message })

  // F1：仓库里不许再有 skill.json。
  for (const name of Object.keys(files)) {
    if (name === 'skill.json' || name.endsWith('/skill.json')) {
      fail('F1', `还有 ${name}——技能清单的唯一 owner 是 SKILL.md 的 frontmatter`)
    }
  }

  const body = files['SKILL.md']
  if (typeof body !== 'string') {
    fail('F2', '缺少 SKILL.md')
    return errors
  }

  const raw = extractFrontmatter(body)
  if (raw === null) {
    fail('F2', 'SKILL.md 没有 YAML frontmatter（必须以 --- 开头、以 --- 闭合）')
    return errors
  }

  // F2：frontmatter 必须是合法 YAML。用真解析器，不用正则——正则的宽松正是问题本身。
  let front
  try {
    front = yaml.load(raw, { schema: yaml.JSON_SCHEMA })
  } catch (error) {
    fail('F2', `frontmatter 不是合法 YAML：${error.message.split('\n')[0]}（多半是没加引号的值里带了 ": "）`)
    return errors
  }
  if (!front || typeof front !== 'object' || Array.isArray(front)) {
    fail('F2', 'frontmatter 必须是一个映射')
    return errors
  }

  // F3：必填字段齐全且合规。
  const name = front.name
  if (typeof name !== 'string' || !name.trim()) {
    fail('F3', '缺少必填字段 name')
  } else {
    if (name.length > MAX_NAME_LENGTH) fail('F3', `name 超过 ${MAX_NAME_LENGTH} 字符：${name.length}`)
    if (!NAME_PATTERN.test(name)) {
      fail('F3', `name「${name}」不合规范：只允许小写 a-z / 0-9 / 连字符，且不得首尾或连续连字符`)
    }
    if (name !== dirName) fail('F3', `name「${name}」必须与目录名「${dirName}」一致（Agent Skills 规范硬要求）`)
  }
  const description = front.description
  if (typeof description !== 'string' || !description.trim()) {
    fail('F3', '缺少必填字段 description')
  } else if (description.length > MAX_DESCRIPTION_LENGTH) {
    fail('F3', `description 超过 ${MAX_DESCRIPTION_LENGTH} 字符：${description.length}`)
  }

  // F4：顶层键在白名单内。Nomi 独有的东西一律住 metadata.nomi.*。
  for (const key of Object.keys(front)) {
    if (!ALLOWED_TOP_LEVEL_FIELDS.includes(key)) {
      fail('F4', `顶层键「${key}」不在允许列表内（${ALLOWED_TOP_LEVEL_FIELDS.join(' / ')}）——Nomi 独有字段请放 metadata.nomi.*`)
    }
  }
  if (front.metadata !== undefined && (!front.metadata || typeof front.metadata !== 'object' || Array.isArray(front.metadata))) {
    fail('F4', 'metadata 必须是一个映射')
  }

  return errors
}

/** 从磁盘读一个技能目录的文件表（只读顶层 + 一层子目录，够判 F1）。 */
export function readSkillDirectory(absDir) {
  const files = {}
  const walk = (dir, prefix, depth) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (depth > 0) walk(path.join(dir, entry.name), rel, depth - 1)
        continue
      }
      if (!entry.isFile()) continue
      if (entry.name === 'SKILL.md' || entry.name === 'skill.json') {
        files[rel] = fs.readFileSync(path.join(dir, entry.name), 'utf8')
      } else {
        files[rel] = ''
      }
    }
  }
  walk(absDir, '', 2)
  return files
}

/** 扫一个 skills 根，返回 `{ dirName, files }` 列表（只收含 SKILL.md 的目录，与加载器同规则）。 */
export function collectSkillDirectories(skillsRoot) {
  if (!fs.existsSync(skillsRoot)) return []
  return fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .filter((dirName) => fs.existsSync(path.join(skillsRoot, dirName, 'SKILL.md')))
    .map((dirName) => ({ dirName, files: readSkillDirectory(path.join(skillsRoot, dirName)) }))
}

/**
 * F6：让 pi 自己的加载器判分。要求「目录里有几个 SKILL.md 就加载出几个，且零 diagnostics」。
 * 这条不是我们写的判据——它证明的是「别人能不能读我们的东西」，而 `check:framework-boundary`
 * 管的是反方向（pi 已有的能力不许再写一份）。
 * 加载器路径写死到 dist：包的 exports 没暴露这个子路径，而我们要的正是它内部那份判据。
 */
export async function checkPiLoader(skillsRoot, repoRoot) {
  const loaderPath = path.join(
    repoRoot,
    'node_modules/@earendil-works/pi-coding-agent/dist/core/skills.js',
  )
  if (!fs.existsSync(loaderPath)) {
    return { skipped: true, reason: `pi 加载器不在（${loaderPath}）——今天没查成，不当通过` }
  }
  const { loadSkillsFromDir } = await import(`file://${loaderPath}`)
  const expected = collectSkillDirectories(skillsRoot).length
  const result = loadSkillsFromDir({ dir: skillsRoot, source: 'path' })
  const errors = []
  if (result.skills.length !== expected) {
    errors.push({
      rule: 'F6',
      dirName: '(pi loader)',
      message: `pi 只加载出 ${result.skills.length} 个技能，目录里有 ${expected} 个——有技能在别的宿主里是不存在的`,
    })
  }
  for (const diagnostic of result.diagnostics) {
    errors.push({
      rule: 'F6',
      dirName: path.basename(path.dirname(diagnostic.path ?? '')) || '(pi loader)',
      message: `pi 加载器有话说：${String(diagnostic.message).split('\n')[0]}`,
    })
  }
  return { skipped: false, errors, loaded: result.skills.length, expected }
}
