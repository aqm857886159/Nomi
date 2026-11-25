import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const realMediaWalks = new Set([
  'tests/ux/browser-extract-real.rehearsal.walk.mjs',
  'tests/ux/real-media-import.walk.mjs',
])

function realMediaSkipReason(dir) {
  if (!dir?.trim()) return 'NOMI_REAL_MEDIA_DIR is unset'
  try {
    if (fs.statSync(dir).isDirectory()) return null
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
  }
  return 'NOMI_REAL_MEDIA_DIR is not a directory'
}

export function loadNightlyExclusions(root = repoRoot) {
  const source = JSON.parse(fs.readFileSync(path.join(root, 'tests/ux/nightly-ci-exclusions.json'), 'utf8'))
  return new Map(source.exclusions.map((entry) => [entry.path, entry]))
}

export function selectNightlyWalks(files, { root = repoRoot } = {}) {
  const exclusions = loadNightlyExclusions(root)
  return [...files]
    .map((file) => file.replaceAll('\\', '/'))
    .filter((file) => file.endsWith('.walk.mjs') && !file.endsWith('.paid.mjs'))
    .filter((file) => !exclusions.has(file))
    .sort()
}

function listWalks(directory, root = repoRoot) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.posix.join(path.relative(root, directory).replaceAll('\\', '/'), entry.name))
}

/** 夜跑真正会跑的那份清单（工作流调本文件 CLI 拿的就是它）：目录顶层的走查，去掉登记的排除项。 */
export function nightlyWalkInventory({ root = repoRoot, directory = 'tests/ux' } = {}) {
  return selectNightlyWalks(listWalks(path.resolve(root, directory), root), { root })
}

/**
 * 夜跑分几批——只在这里定。工作流的循环、汇总脚本的应跑清单都调 walksForBatch，不各写一份取模。
 *
 * 为什么是 10（2026-11-21）：之前写死 4 批，每批 103 条；11-20 实测单条平均 50–89 秒，一批要 86–153 分钟，
 * 作业上限 90 分钟——两批只跑到 59 条就被取消，414 条里 91 条当晚没有结果，这样已经连续多晚。
 * 10 批每批约 41 条，按最慢那批的 89 秒算约 61 分钟，加上装依赖和构建约 6 分钟，离 90 分钟留四分之一余量。
 * 走查再变多、变慢到不够时，汇总会报「未完整完成」，改这个数即可。
 */
export const NIGHTLY_WALK_BATCH_COUNT = 10

export function nightlyWalkBatchIds() {
  return Array.from({ length: NIGHTLY_WALK_BATCH_COUNT }, (_, index) => String(index))
}

/** 第 batch 批跑哪些：按清单下标对批次数取模。batch 不是合法批号就抛错，不悄悄返回空清单。 */
export function walksForBatch(walks, batch) {
  const index = Number(batch)
  if (!/^\d+$/.test(String(batch)) || index >= NIGHTLY_WALK_BATCH_COUNT) throw new Error(`夜跑批号只有 0–${NIGHTLY_WALK_BATCH_COUNT - 1}，收到 ${batch}`)
  return walks.filter((_, position) => position % NIGHTLY_WALK_BATCH_COUNT === index)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // --include-skips 保留整批成员，跳过项在文件名后附制表符与原因，供工作流记录状态 125。
  const args = process.argv.slice(2)
  const flag = args.indexOf('--batch')
  const batch = flag >= 0 ? args[flag + 1] : null
  const directory = args.find((arg, index) => !arg.startsWith('--') && (flag < 0 || index !== flag + 1)) ?? 'tests/ux'
  const walks = nightlyWalkInventory({ directory })
  const includeSkips = args.includes('--include-skips')
  const skipReason = realMediaSkipReason(process.env.NOMI_REAL_MEDIA_DIR)
  for (const file of batch === null ? walks : walksForBatch(walks, batch)) {
    if (!skipReason || !realMediaWalks.has(file)) console.log(file)
    else if (includeSkips) console.log(`${file}\t${skipReason}`)
    else console.error(`Skipped ${file}: ${skipReason}`)
  }
}
