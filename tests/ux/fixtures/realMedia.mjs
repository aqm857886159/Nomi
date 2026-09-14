// 真实素材的执行层（R13「四件真实」第④件，2026-09-14）。守一条不变量：
// **画布/性能/导入/导出/走查类测试要用登记过的真实素材；素材缺了就红，不许 skip、不许退回合成素材兜底。**
//
// 起因：2026-09-14 第一次拿用户真实素材（3840×2160 10-bit HEVC、1,380,939,031 字节）跑 Nomi，
// 当场炸两件——① 视频和图片导入不了画布；② S 规模（24 图 + 24 视频）20 秒进不了画布。
// 而画布性能基准跑了几十轮、留了 80 多份结果 JSON 一次都没红过：夹具用的是 ffmpeg `testsrc2`
// 合成的 960×540 平坦色块 PNG 与 2 秒 crf-35 的 720p H.264，解码成本接近零，且**直接写 project.json
// 快照**、导入一步都没走。输入假了，再严谨的断言也只是在证明「假输入下没事」。
//
// 为什么缺素材必须红而不是 skip：skip 就是「登记即放绿」（R17，旧 R28）——那条腿从第一天起
// 就是装饰，而 CI 里一片绿和「真的测过了」长得一模一样。
//
// 素材不进仓库（1.38 GB）：路径走 env NOMI_REAL_MEDIA_DIR，登记表只记规格与来源。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
export const REGISTRY_FILE = path.join(repoRoot, 'tests/ux/real-media-fixtures.json')

export function readRealMediaRegistry() {
  return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'))
}

/**
 * 解析素材目录。读不到 env 就抛——**不回退到本机默认路径**：
 * 登记表里的 localDefaultDir 是给人看的提示，不是给脚本兜底的第二真相源
 * （兜底一旦存在，CI 上「没配 env」就会静默变成「跑了别的东西」）。
 */
export function resolveRealMediaDir({ env = process.env } = {}) {
  const registry = readRealMediaRegistry()
  const key = registry.mediaEnvVar
  const dir = env[key]
  if (!dir || dir.trim() === '') {
    throw new Error(
      `真实素材缺失：环境变量 ${key} 未设置。\n` +
        `  本机素材在 ${registry.localDefaultDir}\n` +
        `  跑法：export ${key}="${registry.localDefaultDir}"\n` +
        `  登记表：tests/ux/real-media-fixtures.json（素材不进仓库）`,
    )
  }
  return dir
}

/**
 * 要素材。缺一件就抛，消息里逐条列出缺什么、从哪补。
 * 派生素材（如从视频抽的 4K PNG）由调用方用 deriveInto() 生成到 tmp，不落用户目录。
 */
export function requireRealMediaAssets(assetIds, { env = process.env } = {}) {
  const registry = readRealMediaRegistry()
  const dir = resolveRealMediaDir({ env })
  const wanted = assetIds && assetIds.length > 0 ? assetIds : registry.assets.map((a) => a.id)
  const resolved = new Map()
  const missing = []
  for (const id of wanted) {
    const asset = registry.assets.find((a) => a.id === id)
    if (!asset) throw new Error(`真实素材缺失：登记表里没有 id="${id}"`)
    if (asset.derivedFrom) {
      resolved.set(id, { ...asset, file: null, derived: true })
      continue
    }
    const file = path.join(dir, asset.relativePath)
    if (!fs.existsSync(file)) {
      missing.push(`  - ${id} → ${file}（来源：${asset.source}）`)
      continue
    }
    resolved.set(id, { ...asset, file, derived: false })
  }
  if (missing.length > 0) {
    throw new Error(`真实素材缺失（${missing.length} 件），不跳过、不退回合成素材：\n${missing.join('\n')}`)
  }
  return { dir, assets: resolved }
}
