#!/usr/bin/env node
// 内置供应商身份门岗（issue #831，R17 棘轮族）。
//
// 守的不变量：**「这条 vendor 是不是某个内置家」只许经 electron/shared/builtinVendorIdentity 问。**
//
// 起因（这一族的类根因）：连接身份原本 = 域名，于是全仓十几处直接写
// `vendor.key === "apimart"` 判断身份，而且一直是对的。#831 把身份改成「域名 + 连接名」之后
// key 会长出 `apimart--mini` 这种兄弟连接，那十几处**集体认错**，症状各不相同
// （上传通道退回匿名图床 / 图生图消失 / 推荐徽章不见 / 默认家静默换人），
// 没有一处会报错。靠人记得改 = 下一个新内置家再来一次。
//
// 三条判据：
//   ① 身份字面量比较：`<vendor-ish> === "apimart"` / `!==` / `.has("apimart")` / `new Set([… "kie" …])`
//   ② `deriveVendorKeyFromBaseUrl(` 直接调用（它自此只是 connectionVendorKey.ts 的内部 host 步）
//   ③ 豁免名单本身必须指得到真实文件真实行——豁免要当断言验，不能只写在注释里
//      （2026-09-xx「死 i18n 词条」那一课：写在注释里的豁免会悄悄过期）。
//
// 棘轮：debt 里登记的是**别的会话正在改写**的两个文件（总合并时统一收），只减不增、到期即红；
// 其余文件硬零。加规则前先验它会红（阳性对照）：改之前本脚本在 origin/main 上命中 20+ 处。
//
// 和 `check:concept-owners` 里身份比对那条判据（原 check:identity-compare，2026-09-29 并入）的分工
// （别当成两份同样的东西）：那一条管「同一种身份被抄了几份**多维比对函数**」（端口绑定 / 项目选择那一族）；
// 本条管「身份被写成**单个 key 字面量**」。形状不同、失败模式不同，各守各的。
//
// 用法：node scripts/check-builtin-vendor-literals.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROOTS = ['electron', 'src']
const EXTS = new Set(['.ts', '.tsx'])

/** 会长出「兄弟连接」的内置家：有「地址 + Key」形态的那些。 */
const IDENTITY_KEYS = [
  'apimart', 'kie', 'newapi', 'volcengine', 'volcengine-speech', 'agnes', 'modelscope',
  'minimax', 'elevenlabs', 'meshy', 'higgsfield', 'fal', 'runway', 'replicate', 'runninghub',
]

/** 唯一允许 import `deriveVendorKeyFromBaseUrl` 的地方（它的 host 步 owner）。 */
const HOST_STEP_OWNER = 'electron/catalog/connectionVendorKey.ts'
/** 定义它自己的文件。 */
const HOST_STEP_DEFINITION = 'electron/catalog/catalogCommit.ts'

/**
 * 豁免：这些字面量是**准确**的，不是漏网。每条都写明为什么，且下面会断言它真的还在。
 * 判据：该 key 的那一家没有「用户填地址 + 填 Key」的接入形态 → 长不出兄弟连接。
 */
const EXEMPTIONS = [
  {
    file: 'src/devlab/designLab/catalogLiveness/states/01-listing.tsx',
    needle: "vendor.vendorKey === 'apimart'",
    why: 'KNOWN_VENDORS 是展示目录，vendorKey 恒为内置 key，不是运行时 vendor 行。',
  },
]

/**
 * 棘轮债：别的会话（Core-A 打捞分支）正在改写这两个文件，总合并时由它统一改用
 * builtinVendorIdentity。**只减不增，到期即红。**
 */
// 2026-09-22 总合并：两条债目都还清了 —— `generationProviderBootstrap.ts` 在打捞分支上已重写成
// **目录驱动的通用执行器**（不再按 key 字面量认家，身份由调用方给的 vendorKey 决定），
// `ModelSettingsHome.tsx` 那条在本分支上并不存在同名文件。棘轮只减不增：这张表空着才是对的。
const DEBT = []

const alt = IDENTITY_KEYS.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
/** ① 比较型：等号两侧之一是 vendor-ish 标识符。 */
const COMPARE = new RegExp(
  String.raw`(?:\.key|[Vv]endorKey|providerId|targetVendor|modelVendor|\bvendor\b)\s*(?:===|!==)\s*['"](?:${alt})['"]`,
)
/** ② 集合型：`.has('apimart')` 与 `new Set([... 'apimart' ...])`（vendorTier 那一族的形状）。 */
const SET_HAS = new RegExp(String.raw`\.has\(\s*['"](?:${alt})['"]\s*\)`)
const SET_LITERAL = new RegExp(String.raw`VENDOR_KEYS\s*=\s*new Set\(`)
/** ③ host 步直接调用。 */
const HOST_STEP = /\bderiveVendorKeyFromBaseUrl\s*\(/

const rel = (file) => path.relative(repoRoot, file).split(path.sep).join('/')

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (EXTS.has(path.extname(entry.name))) out.push(full)
  }
  return out
}

const files = ROOTS.flatMap((root) => {
  const dir = path.join(repoRoot, root)
  return fs.existsSync(dir) ? walk(dir, []) : []
})

const hits = []
for (const file of files) {
  const id = rel(file)
  // 测试文件刻意排除：测试本来就该按字面量钉死具体身份（不然它测不出东西）。
  if (/\.test\.tsx?$/.test(id) || id.includes('/__tests__/')) continue
  const source = fs.readFileSync(file, 'utf8')
  const resolvesIdentity = source.includes('builtinVendorIdentity')
  const lines = source.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    // 注释行不算（说明为什么豁免的那些话里会提到 key 名）。
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue
    let rule = null
    if (COMPARE.test(line)) rule = 'identity-literal'
    // 集合型：`.has('apimart')` 永远是违规（参数是字面量 = 没解析过）；
    // `new Set([...vendorKeys])` 的**声明**本身不是违规 —— 违规的是「声明了这么一张表，
    // 却从不解析 root 就拿裸 key 去查」。所以只在该文件根本没引 builtinVendorIdentity 时报。
    else if (SET_HAS.test(line) || (SET_LITERAL.test(line) && !resolvesIdentity)) rule = 'identity-set'
    else if (HOST_STEP.test(line) && id !== HOST_STEP_OWNER && id !== HOST_STEP_DEFINITION) rule = 'host-step-direct-call'
    if (!rule) continue
    if (EXEMPTIONS.some((item) => item.file === id && line.includes(item.needle))) continue
    hits.push({ rule, id, line: i + 1, text: line.trim() })
  }
}

const errors = []

// 豁免名单必须指得到（断言验，不是注释）。
for (const item of EXEMPTIONS) {
  const full = path.join(repoRoot, item.file)
  if (!fs.existsSync(full)) {
    errors.push(`豁免名单过期：${item.file} 不存在了 —— 删掉这条豁免。`)
    continue
  }
  if (!fs.readFileSync(full, 'utf8').includes(item.needle)) {
    errors.push(`豁免名单过期：${item.file} 里已经没有 \`${item.needle}\` —— 删掉这条豁免（棘轮只减不增）。`)
  }
}

const today = new Date().toISOString().slice(0, 10)
const debtFiles = new Set(DEBT.map((item) => item.file))
for (const item of DEBT) {
  const full = path.join(repoRoot, item.file)
  if (!fs.existsSync(full)) {
    errors.push(`债目过期：${item.file} 不存在了 —— 从 DEBT 删掉它。`)
    continue
  }
  if (!hits.some((hit) => hit.id === item.file)) {
    errors.push(`债目已还清：${item.file} 里已无命中 —— 从 DEBT 删掉它以锁定战果（棘轮只减不增）。`)
    continue
  }
  if (today > item.due) {
    errors.push(`债目到期：${item.file}（owner ${item.owner}，到期 ${item.due}）—— 到期即红，去收它，别改到期日。`)
  }
}

const newHits = hits.filter((hit) => !debtFiles.has(hit.id))
if (newHits.length > 0) {
  errors.push(
    `身份判据仍有 ${newHits.length} 处写成字面量/集合查表 —— 全部改走 electron/shared/builtinVendorIdentity：\n` +
      newHits.map((hit) => `     · [${hit.rule}] ${hit.id}:${hit.line}  ${hit.text}`).join('\n'),
  )
}

if (errors.length > 0) {
  console.error('✖ 内置供应商身份门岗失败（#831：兄弟连接 `apimart--mini` 会被字面量判据集体认错）：')
  for (const error of errors) console.error(`  - ${error}`)
  console.error('')
  console.error('  → 有 vendors 列表：isVendorOfBuiltin(vendors, key, "apimart")')
  console.error('  → 只有 key 字符串：builtinVendorKeyOfKey(key) === "apimart"')
  console.error('  → 从 baseUrl 要 key：resolveConnectionVendorKey / resolveHostVendorKey（catalog/connectionVendorKey.ts）')
  console.error('  → 确实准确的字面量：进 EXEMPTIONS 并写清为什么（会被断言验）。禁止抬基线挤 PR。')
  process.exit(1)
}

console.log(`scanned=${files.length}`)
console.log(
  `✅ 内置供应商身份门岗：扫 ${files.length} 个文件；新增违规 0；` +
    `豁免 ${EXEMPTIONS.length} 条（已验证仍存在）；债 ${DEBT.length} 条（最早到期 ${DEBT.map((d) => d.due).sort()[0] ?? '—'}）。`,
)
