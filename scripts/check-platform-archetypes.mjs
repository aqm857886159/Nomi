#!/usr/bin/env node
// 门岗：禁止「平台档案」—— 一个档案罩住同一供应商的多个**不同产品**（P4）。
//
// 为什么要这个门岗（2026-09-02 真实缺陷）：`runway-video` 一个档案罩了 10 个完全不同的
// 模型，它对外声明的能力面只能取这 10 个的**并集**——于是对其中每一个模型都在撒谎（这个模型
// 明明不支持首尾帧，UI 却因为同档案里另一个模型支持而把控件亮出来）。已在本分支删除。
//
// 图像侧同族 `runway-image`（罩 9 个不同图像产品）随后也已拆除（合同
// docs/fixes/2026-09-02-runway-image-identity.root-cause.json）：照官方 OpenAPI 逐模型对账，
// 它给全部产品发的那套共享比例在 **10 个变体里 10 个**都至少有一个非法值，传输层只好靠一张
// 手工补丁表静默改写其中 3 个——「能力面与 wire 两个作者」的教科书样本。基线 3 → 2。
// 同族现存两个：modelscope-image / runway-audio。
//
// ⚠️ 关键区分：「一个档案服务多行目录」**本身不是缺陷**，恰恰是我们要的形状：
//   - 同一个模型由多个供应商提供（gpt-image-2 在 kie + apimart + fal）= P4 的目标形状；
//   - 同一个模型的变体（seedance-2 的 standard/fast/mini 走 variants 轴）= 正确。
// 缺陷只有一种：**不同产品**共用一个档案。所以不能数目录行数（实测正确档案普遍多行，
// veo-3.1 三行、seedance-2 三行），必须看档案自己声明的 identifierPatterns 指向几个产品。
//
// ── 判别信号（这是本门岗的核心，改之前先读懂）──────────────────────────────
// 把每条 identifierPattern 归一成「产品词干」：去供应商前缀（bytedance/…）、去分隔符、
// 去 t2v/i2v 这类模式后缀、去版本号、去变体词（fast/mini/pro/turbo/fal/rh…）。再把词干
// 按「互为子串」聚类（gen ⊂ runwaygen、seedream ⊂ doubaoseedream 是同一产品的写法差异）。
//
// 判据：**词干簇 > 2 即平台档案。**
// 为什么是 2 而不是 1：一个产品可以有**一个**别名——供应商内部代号或 SKU
// （nano-banana-2 ↔ gemini-3.1-flash-image；rh-veo-3.1 ↔ rhart-video-v3.1-pro-official）。
// 一个产品有两套名字是常态，有三套就不成立了——三个互不相干的词干只能是三个产品。
// 实测分离干净且有真实间隔：三个违规是 7 / 5 / 4 簇，全部正确档案 ≤ 2 簇，**没有任何档案落在 3**。
// 阈值不是凑出来的，是「别名最多一套」这个语义推出来的，间隔证明它没卡在边上。
//
// 已知盲区（诚实标注，别假装没有）：**恰好两个产品**的平台档案（词干簇 = 2）逃得掉，
// 因为它与「一个产品 + 一个别名」在字符串层面无法区分。这是信号本身的极限，不是没调参
// ——把阈值降到 >1 会把 gpt-image-2 / nano-banana-2 / rh-* 一片正确档案全部误报，
// 而误报的门岗比没有门岗更糟（会被习惯性忽略）。真出现两产品平台档案要靠评审抓。
//
// 棘轮：存量三个进基线，**只减不增**（与 boundaries / filesize / archetype-sources 同款纪律）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const baselinePath = path.join(repoRoot, 'scripts/platform-archetypes-baseline.json')
// 档案是真相源（渲染层），generated 文件只是主进程侧的桥接副本。读真相源，
// 免得有人改了档案没跑 gen 就以为门岗过了。
const archetypeDirs = [
  path.join(repoRoot, 'src/config/modelArchetypes'),
  path.join(repoRoot, 'electron/shared/videoCapabilities'),
]

/** 变体/供应商修饰词：这些词区分的是同一产品的档位或渠道，不是不同产品。 */
const VARIANT_WORDS = /(fast|mini|lite|turbo|pro|max|plus|quality|ultra|preview|official|standard|std|edit|hd|vip|ext|apimart|rh|fal|v\d+)/g
/** 模式后缀：text-to-video / image-to-image 这类是同一产品的入参形态。 */
const MODE_SUFFIX = /(text|image|video|audio|reference|sound|multilingual)?to(video|image|audio|sound)/g

/** identifierPattern → 产品词干。 */
function productStem(pattern) {
  let x = String(pattern).toLowerCase()
  const slash = x.lastIndexOf('/')
  if (slash >= 0) x = x.slice(slash + 1) // 去供应商命名空间前缀
  x = x.replace(/[-_.\s]/g, '')
  x = x.replace(MODE_SUFFIX, '')
  x = x.replace(/\d+/g, '') // 版本号：seedance-2 / seedance-2.5 是同一产品线
  x = x.replace(VARIANT_WORDS, '')
  return x
}

/** 互为子串的词干归为一簇（同一产品的不同写法）。 */
function clusterStems(stems) {
  const clusters = []
  for (const stem of [...stems].sort((a, b) => a.length - b.length)) {
    const hit = clusters.find((c) => c.some((e) => stem.includes(e) || e.includes(stem)))
    if (hit) hit.push(stem)
    else clusters.push([stem])
  }
  return clusters
}

/** 从档案源码里抽 { id, identifierPatterns }。 */
function readArchetypes() {
  const found = []
  for (const dir of archetypeDirs) {
    if (!fs.existsSync(dir)) continue
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    for (const file of files) {
      const src = fs.readFileSync(path.join(dir, file), 'utf8')
      // 逐个档案对象认：id 在前、identifierPatterns 在后（本仓所有档案都是这个顺序）。
      for (const m of src.matchAll(/\bid:\s*["']([^"']+)["'][\s\S]*?\bidentifierPatterns:\s*\[([\s\S]*?)\]/g)) {
        const patterns = [...m[2].matchAll(/["']([^"']+)["']/g)].map((p) => p[1])
        if (patterns.length > 0) found.push({ id: m[1], file, patterns })
      }
    }
  }
  return found
}

const archetypes = readArchetypes()
if (archetypes.length === 0) {
  console.error('✗ 平台档案门岗：一个档案都没扫到 —— 抽取正则大概率失配了，不许静默放行。')
  process.exit(1)
}

const offenders = []
for (const { id, file, patterns } of archetypes) {
  const stems = [...new Set(patterns.map(productStem).filter(Boolean))]
  const clusters = clusterStems(stems)
  if (clusters.length > 2) {
    offenders.push({ id, file, products: clusters.map((c) => c[0]).sort() })
  }
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
const known = new Set(baseline.platformArchetypes)
const currentIds = offenders.map((o) => o.id)

const added = offenders.filter((o) => !known.has(o.id))
const fixed = [...known].filter((id) => !currentIds.includes(id))

if (added.length > 0) {
  console.error('✖ 平台档案门岗未通过：新增「一个档案罩多个不同产品」的档案。\n')
  for (const o of added) {
    console.error(`  ✗ ${o.id}（${o.file}）罩了 ${o.products.length} 个不同产品：${o.products.join(', ')}`)
  }
  console.error('\n为什么这是缺陷：档案对外声明的能力面会变成这些产品的**并集**，')
  console.error('于是对其中每一个模型都在撒谎（模型 A 不支持的能力，因为模型 B 支持而被亮出来）。')
  console.error('正解：一个模型一个档案；供应商差异走专精轴（variants / vendorParams），不要合并成平台档案。')
  console.error(`\n⛔ 绝不允许把新档案追加进 ${path.relative(repoRoot, baselinePath)} 抬高基线——这个棘轮只减不增。`)
  process.exit(1)
}

if (fixed.length > 0) {
  console.error('✖ 基线过期：以下档案已经拆干净了，但仍留在基线里（成了永久豁免）：\n')
  for (const id of fixed) console.error(`  ✗ ${id}`)
  console.error(`\n你拆好了一个平台档案——请从 ${path.relative(repoRoot, baselinePath)} 删掉对应行以锁定战果（棘轮只减不增）。`)
  process.exit(1)
}

console.log(
  `✅ 平台档案棘轮通过：扫 ${archetypes.length} 个档案，${offenders.length} 个存量平台档案（基线 ${known.size}，只减不增）。`,
)
