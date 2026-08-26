// 技能导入的「解析前端」：把用户手上的各种真实形态归一成 `{dirName, files}` 交给主进程校验落地。
//
// 为什么要这层（2026-08-27）：此前只认我们自己导出的 `.nomiskill.json` 信封 —— 别人的技能一律进不来，
// 用户原话「正常用 hermes 或 workbuddy 都是导入一个 zip 包就行，包里有 skill.md 就行了」。
// 而生态早已收敛到「文件夹 + SKILL.md + YAML frontmatter」，我们**自己的 SKILL.md 本来就是这个格式**
// （name + description 两个必填字段一字不差），只是被自造信封包住了。按 R20：技能打包不是 Nomi 独有
// 问题、不在护城河上、且碰用户信任（导入别人的东西）→ 对齐标准，不自造。
//
// 边界：这里只做「形状归一 + 明显不合法早退」，**真正的安全校验（路径穿越/扩展名/可执行区）在主进程**
// （electron/skills/skillPackage.ts），渲染层的判断一律不可信。版本号也只在主进程盖，这里不复制。
import { unzipSync } from 'fflate'

/** 交给主进程的裸文件表（主进程会盖版本戳后走 validateSkillPackage）。 */
export type SkillImportPayload = { dirName: string; files: Record<string, string> }

export type SkillImportParse =
  | { ok: true; payload: SkillImportPayload; skipped: string[] }
  | { ok: false; reason: SkillImportFailure; detail?: string }

/** 失败原因用枚举而非文案：文案走 i18n（R15），这里不拼中文。 */
export type SkillImportFailure =
  | 'unsupportedType'
  | 'badJson'
  | 'zipBroken'
  | 'noSkillMd'
  | 'empty'
  | 'tooBig'

/** 单个技能包上限：技能是文本，10MB 已经极宽松；防的是误选大文件/zip 炸弹。 */
const MAX_BYTES = 10 * 1024 * 1024
/** 与主进程 SKILL_TEXT_EXT 对齐（那边是真相源，这里是提前过滤，少传无用字节）。 */
const TEXT_EXT = /\.(md|markdown|json|txt|ya?ml|csv)$/i

/** 从 SKILL.md 的 YAML frontmatter 取 `name:`（标准规范的必填字段之一）。 */
export function readFrontmatterName(markdown: string): string {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return ''
  const name = match[1].match(/^name:\s*["']?(.+?)["']?\s*$/m)
  return (name?.[1] ?? '').trim()
}

/** 目录名建议：frontmatter name > 文件名。清洗/避让由主进程 resolveImportDirName 负责。 */
function suggestDirName(markdown: string, fallback: string): string {
  return readFrontmatterName(markdown) || fallback.replace(/\.(md|markdown|zip|json)$/i, '') || 'imported-skill'
}

/** ① 裸 SKILL.md —— 一个文件就能建一个技能（最常见的分享形态）。 */
export function packageFromMarkdown(fileName: string, text: string): SkillImportParse {
  if (!text.trim()) return { ok: false, reason: 'empty' }
  return { ok: true, payload: { dirName: suggestDirName(text, fileName), files: { 'SKILL.md': text } }, skipped: [] }
}

/**
 * zip 里常见两种布局：SKILL.md 在根，或被包在单层文件夹里（GitHub 下载的 zip 是 `repo-main/`）。
 * 找到 SKILL.md 所在层级，把它当根、剥掉公共前缀 —— 否则解出来会多套一层目录、SKILL.md 不在根部而校验失败。
 */
export function stripCommonPrefix(paths: string[]): { prefix: string; ok: boolean } {
  const skillMd = paths.filter((p) => /(^|\/)SKILL\.md$/i.test(p))
  if (!skillMd.length) return { prefix: '', ok: false }
  // 取层级最浅的那个当锚（多层嵌套时以最外层为准）
  const anchor = skillMd.sort((a, b) => a.split('/').length - b.split('/').length)[0]
  const idx = anchor.toLowerCase().lastIndexOf('skill.md')
  return { prefix: anchor.slice(0, idx), ok: true }
}

/** ② zip —— 保留子目录（references/ assets/），二进制与超深路径如实计入 skipped，不静默丢。 */
export function packageFromZipEntries(
  entries: Record<string, Uint8Array>,
  fallbackName: string,
): SkillImportParse {
  const names = Object.keys(entries).filter((n) => !n.endsWith('/'))
  if (!names.length) return { ok: false, reason: 'empty' }
  const { prefix, ok } = stripCommonPrefix(names)
  if (!ok) return { ok: false, reason: 'noSkillMd' }

  const decoder = new TextDecoder('utf-8', { fatal: false })
  const files: Record<string, string> = {}
  const skipped: string[] = []
  for (const name of names) {
    if (!name.startsWith(prefix)) {
      skipped.push(name)
      continue
    }
    const rel = name.slice(prefix.length)
    // macOS 打包残留 + 隐藏文件：直接忽略，不当作「跳过的内容」惊扰用户
    if (!rel || rel.startsWith('__MACOSX/') || rel.split('/').some((s) => s.startsWith('.'))) continue
    if (!TEXT_EXT.test(rel)) {
      skipped.push(rel)
      continue
    }
    files[rel] = decoder.decode(entries[name])
  }
  if (!files['SKILL.md']?.trim()) return { ok: false, reason: 'noSkillMd' }
  return { ok: true, payload: { dirName: suggestDirName(files['SKILL.md'], fallbackName), files }, skipped }
}

/** ③ 我们自己导出的 `.nomiskill.json` 信封 —— 原样透传（主进程按 version 走既有校验）。 */
export function packageFromEnvelope(json: unknown): SkillImportParse {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { ok: false, reason: 'badJson' }
  const obj = json as Record<string, unknown>
  if (typeof obj.dirName !== 'string' || !obj.files || typeof obj.files !== 'object') {
    return { ok: false, reason: 'badJson' }
  }
  return { ok: true, payload: obj as unknown as SkillImportPayload, skipped: [] }
}

/** 入口：按扩展名/内容分派到三条解析路径。 */
export async function parseSkillImportFile(file: File): Promise<SkillImportParse> {
  if (file.size > MAX_BYTES) return { ok: false, reason: 'tooBig' }
  const lower = file.name.toLowerCase()

  if (lower.endsWith('.zip')) {
    let entries: Record<string, Uint8Array>
    try {
      entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
    } catch (err) {
      return { ok: false, reason: 'zipBroken', detail: (err as Error).message }
    }
    return packageFromZipEntries(entries, file.name)
  }

  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return packageFromMarkdown(file.name, await file.text())
  }

  if (lower.endsWith('.json') || lower.endsWith('.nomiskill')) {
    try {
      return packageFromEnvelope(JSON.parse(await file.text()))
    } catch {
      return { ok: false, reason: 'badJson' }
    }
  }

  return { ok: false, reason: 'unsupportedType' }
}
