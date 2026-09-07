/**
 * 技能「拖进来」的收件层（2026-09-07）。
 *
 * 为什么要它（真实用户摩擦，本轮走查实拍）：
 *  ① 群里发来的技能是**一个 zip**，用户的第一反应是把它拖进面板——今天拖进来**什么都不会发生**
 *     （主进程的 will-navigate 守卫把默认导航挡了，于是连报错都没有，静默）。导入只有一条路：
 *     点「导入文件」→ 系统对话框。
 *  ② pi / bigpowers 这类生态里的技能是**一个文件夹**（`audit-code/SKILL.md`），
 *     系统对话框的 `accept` 选不中文件夹，用户得先自己压成 zip 才进得来——凭什么？
 *
 * 拖拽是**加速器不是新入口**（设计系统 §1.5.2：快捷键/手势不占常驻预算），
 * 所以这里不新增按钮，只让已有的技能库面板认得「松手」这个动作。
 *
 * 边界：这里只做**输入形状归一**（DataTransfer → 一个或多个 `{dirName, files}`），
 * 格式解析仍复用 `parseSkillImport.ts` 的既有导出，真正的安全校验仍在主进程
 * （`electron/skills/skillPackage.ts`）——渲染层的判断一律不可信。
 */
import { parseSkillImportFile, readFrontmatterName, type SkillImportParse } from './parseSkillImport'

/** 与 `parseSkillImport.ts` 的 TEXT_EXT 对齐（那边是提前过滤，主进程才是真相源）。 */
const TEXT_EXT = /\.(md|markdown|json|txt|ya?ml|csv)$/i
/** 目录遍历深度上限，和主进程 SKILL_PATH_MAX_DEPTH 同口径，防深层炸弹。 */
const MAX_DEPTH = 4
/** 单次拖入的文件数上限：技能是知识层，几十个文件已经离谱，防误拖整个下载目录。 */
const MAX_ENTRIES = 400

/** 只依赖我们真正用到的那几个成员，方便单测喂一棵假树（不 mock 整个 FileSystem API）。 */
export type DirEntryLike = {
  isFile: boolean
  isDirectory: boolean
  name: string
  file?: (ok: (file: File) => void, fail: (err: unknown) => void) => void
  createReader?: () => { readEntries: (ok: (entries: DirEntryLike[]) => void, fail: (err: unknown) => void) => void }
}

function readEntriesOnce(reader: ReturnType<NonNullable<DirEntryLike['createReader']>>): Promise<DirEntryLike[]> {
  return new Promise((resolve) => reader.readEntries(resolve, () => resolve([])))
}

/** 一个目录 reader 要反复读到空为止——Chromium 每次最多给 100 条，只读一次会**静默丢文件**。 */
async function readAllEntries(entry: DirEntryLike): Promise<DirEntryLike[]> {
  if (!entry.createReader) return []
  const reader = entry.createReader()
  const all: DirEntryLike[] = []
  for (;;) {
    const batch = await readEntriesOnce(reader)
    if (!batch.length) return all
    all.push(...batch)
    if (all.length > MAX_ENTRIES) return all
  }
}

function readFileText(entry: DirEntryLike): Promise<string | null> {
  if (!entry.file) return Promise.resolve(null)
  return new Promise((resolve) => {
    entry.file!(
      (file) => file.text().then(resolve).catch(() => resolve(null)),
      () => resolve(null),
    )
  })
}

export type FolderIntake = { files: Record<string, string>; skipped: string[] }

/** 递归读一个拖进来的文件夹的知识层文本；二进制/超深路径如实计入 skipped，不静默丢。 */
export async function collectFolderFiles(root: DirEntryLike): Promise<FolderIntake> {
  const files: Record<string, string> = {}
  const skipped: string[] = []
  const walk = async (entry: DirEntryLike, prefix: string, depth: number): Promise<void> => {
    if (Object.keys(files).length + skipped.length > MAX_ENTRIES) return
    // 隐藏文件与 macOS 打包残留：直接忽略，不当作「跳过的内容」惊扰用户
    if (entry.name.startsWith('.') || entry.name === '__MACOSX') return
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory) {
      if (depth >= MAX_DEPTH) return
      for (const child of await readAllEntries(entry)) await walk(child, rel, depth + 1)
      return
    }
    if (!TEXT_EXT.test(entry.name)) {
      skipped.push(rel)
      return
    }
    const text = await readFileText(entry)
    if (text === null) {
      skipped.push(rel)
      return
    }
    files[rel] = text
  }
  for (const child of await readAllEntries(root)) await walk(child, '', 1)
  return { files, skipped }
}

/** 文件夹 → 导入载荷。目录名建议同 md 路径：frontmatter name > 文件夹名。 */
export async function packageFromFolder(root: DirEntryLike): Promise<SkillImportParse> {
  const { files, skipped } = await collectFolderFiles(root)
  if (!Object.keys(files).length && !skipped.length) return { ok: false, reason: 'empty' }
  const body = files['SKILL.md']
  if (!body?.trim()) return { ok: false, reason: 'noSkillMd' }
  return { ok: true, payload: { dirName: readFrontmatterName(body) || root.name, files }, skipped }
}

/**
 * 松手那一刻的收件：把 DataTransfer 里的每一项归一成一次导入尝试。
 *
 * 一次拖多个是允许的（群里常常一口气发三个技能包），每一项各自成败、各自给回执——
 * 一个坏包不该把另外两个好包一起否掉。
 */
export async function parseSkillDrop(dataTransfer: DataTransfer): Promise<SkillImportParse[]> {
  const items = Array.from(dataTransfer.items ?? [])
  const folders: DirEntryLike[] = []
  const plainFiles: File[] = []
  for (const item of items) {
    if (item.kind !== 'file') continue
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => DirEntryLike | null }).webkitGetAsEntry?.()
    if (entry?.isDirectory) {
      folders.push(entry)
      continue
    }
    const file = item.getAsFile()
    if (file) plainFiles.push(file)
  }
  // `items` 拿不到时（部分平台/合成事件）退回 `files`，别让整次拖拽白掉。
  if (!folders.length && !plainFiles.length) plainFiles.push(...Array.from(dataTransfer.files ?? []))

  const results: SkillImportParse[] = []
  for (const folder of folders) results.push(await packageFromFolder(folder))
  for (const file of plainFiles) results.push(await parseSkillImportFile(file))
  return results
}
