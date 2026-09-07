#!/usr/bin/env node
// 出站策略单一 owner 门岗（R28：防线建在最早能拦住的那层）。
//
// 抓的是**一整族**「同一次生成的两半在两条路上」的退化。类根因见
// docs/fixes/2026-09-07-outbound-policy-split-across-submit-and-retrieval.root-cause.json：
// 提交走 appFetch（对目的地零策略），取回走 hardenedFetch（DNS 解析 + 私网分类会拒绝），
// 于是存在「我们愿意为之付钱的目的地，是我们拒绝读取的目的地」——2026-09-06 真实验收里
// 10 条视频钱扣了、一帧取不回。
//
// 一次修好不算完；**下一个**新增的出站模块只要自己 new 一条路、自己判一次目的地，同族问题就回来。
// 这个门岗把「只有一个 owner 判目的地」变成机器判据：
//
//   规则 1（硬零，无基线）：`electron/networkHostPolicy.ts` 里不许再出现 env 逃生口。
//       旧的 `LAB_ALLOW_LOCALHOST === '1'` 会把整个私网分类器关掉（连 169.254 云元数据一起放行），
//       而且随包发布。实验室要 loopback 只能报精确 origin（setLabTrustedPrivateOrigins）。
//
//   规则 2（棘轮，存身份不存数字）：谁能直接 import `appFetch`（= 拿到一条不过目的地策略的裸出口）
//       冻结在 scripts/outbound-policy-baseline.json。新增 importer → 红；基线里已消失的 → 也红
//       （否则会变成永久豁免）。想新增一条出站路径，就得先在这里显式登记并说明为什么它不需要策略。
//
//   规则 3（棘轮）：谁能直接 import `isPrivateHost`（= 自己做私网分类）同样冻结。
//       目的地分类只该有一个 owner；第二处分类就是第二个判据，也就是下一次不对称。
//
//   规则 4（硬零，无基线）：错误洗白点。生产代码里不许再写
//       `error.message ? error.message : '生成失败'` / `|| 'Generation failed'` 这一族兜底——
//       它把「我们不知道发生了什么」印成一句与顶部状态徽标一字不差的话，零信息零下一步，
//       还顺手盖掉了本可展示的线索。2026-09-06 那条写清了「钱没丢、去确认代理」的出站错误，
//       就是被这一族洗成两个字的。唯一允许的写法是 src/workbench/observability/opaqueFailure.ts
//       的 describeOpaqueFailure（它保留 message/类名/原值，兜底句走 i18n 且刻意不等于徽标文案）。
//       硬零而非棘轮：修完之后一处都不剩，留基线等于给这一族发返场票。i18n 词表本身与测试豁免。
//
// 用法：
//   node ./scripts/check-outbound-policy.mjs                    校验（棘轮）
//   node ./scripts/check-outbound-policy.mjs --update-baseline  重算基线（只在真降/初始化时用）

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const baselinePath = path.join(repoRoot, 'scripts', 'outbound-policy-baseline.json')
const SCAN_ROOTS = ['electron', 'src', 'workers', 'scripts', 'tests']
const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.cjs', '.js'])

/** 策略 owner 自己当然要 import 这些——它就是那个唯一的判据所在地。 */
const POLICY_OWNERS = new Set([
  'electron/networkOutboundPolicy.ts',
  'electron/networkHostPolicy.ts',
  'electron/hardenedFetch.ts',
  'electron/appFetch.ts',
])

const APP_FETCH_IMPORT = /\bfrom\s+["'][^"']*\/?appFetch["']/
const PRIVATE_HOST_IMPORT = /import\s*(?:type\s*)?\{[^}]*\bisPrivateHost\b[^}]*\}\s*from/
const ENV_ESCAPE_HATCH = /process\.env\.[A-Z0-9_]*(?:ALLOW_LOCALHOST|ALLOW_PRIVATE|DISABLE_SSRF)[A-Z0-9_]*/
/**
 * 规则 4 的判据：**错误兜底位置上**的通用失败文案。
 * 只认 `||` / `??` / 三元 `:` 这三种「兜底」语法位，所以 i18n 词表里的 `reason: '生成失败'`
 * （那是词表条目本身，不是兜底）不会被误伤——徽标当然要有一句「生成失败」，错误详情才不许是它。
 */
const GENERIC_FAILURE_TEXT = '生成失败|未知错误|出错了|失败了|Generation failed|Unknown error|Something went wrong'
const ERROR_LAUNDERING = new RegExp(
  String.raw`(?:\|\||\?\?|(?<!\w)\?[^?:\n]{0,120}:)\s*(['"\`])\s*(?:` + GENERIC_FAILURE_TEXT + String.raw`)\s*\1`,
)
/** 词表/文案资源文件：那里就该有这些词，判据只管兜底位。 */
const MESSAGE_CATALOG = /(?:^|\/)(?:i18n|locales)(?:\/|\.ts$)/
/**
 * 注释行豁免——与规则 1「只认真实的 process.env 读取」同一条道理：**病历不是病**。
 * 讲清这一族长什么样、当初怎么把出站错误洗成两个字，本身就得把那个写法原样引出来
 * （opaqueFailure.ts 的文件头、本门岗自己的规则 4 说明）。判据只看会被执行的那些行。
 */
const COMMENT_LINE = /^\s*(?:\/\/|\*|\/\*)/

function isTestFile(relative) {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(relative) || relative.startsWith('tests/')
}

function walk(dir, out = []) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) out.push(full)
  }
  return out
}

const files = SCAN_ROOTS.flatMap((root) => walk(path.join(repoRoot, root)))

const appFetchImporters = []
const privateHostImporters = []
const escapeHatches = []
const launderingPoints = []

for (const absolute of files) {
  const relative = path.relative(repoRoot, absolute).split(path.sep).join('/')
  const source = fs.readFileSync(absolute, 'utf8')
  if (!POLICY_OWNERS.has(relative)) {
    if (APP_FETCH_IMPORT.test(source)) appFetchImporters.push(relative)
    if (PRIVATE_HOST_IMPORT.test(source)) privateHostImporters.push(relative)
  }
  // 规则 1 覆盖整棵**生产**树，含 owner 自己：逃生口在哪儿都不许有。
  // 只认真实的 process.env 读取（策略模块在注释里提到旧开关的名字，那是病历不是开关）。
  // 测试文件豁免，且只能这样：证明「开关已死」的唯一写法就是把它设上再断言无效
  // （networkOutboundPolicy.test.ts 正是这么做的）。测试不随包发布，没有生产影响面。
  if (!isTestFile(relative) && ENV_ESCAPE_HATCH.test(source)) escapeHatches.push(relative)
  // 规则 4 同样覆盖整棵生产树。词表文件与测试豁免（理由见 MESSAGE_CATALOG / isTestFile 注释）。
  if (!isTestFile(relative) && !MESSAGE_CATALOG.test(relative)) {
    for (const [index, line] of source.split('\n').entries()) {
      if (!COMMENT_LINE.test(line) && ERROR_LAUNDERING.test(line)) launderingPoints.push(`${relative}:${index + 1}`)
    }
  }
}

appFetchImporters.sort()
privateHostImporters.sort()

const updating = process.argv.includes('--update-baseline')
if (updating) {
  fs.writeFileSync(
    baselinePath,
    `${JSON.stringify({ appFetchImporters, privateHostImporters }, null, 2)}\n`,
  )
  console.log(`outbound-policy baseline updated: ${appFetchImporters.length} appFetch, ${privateHostImporters.length} isPrivateHost`)
  process.exit(0)
}

if (!fs.existsSync(baselinePath)) {
  console.error(`FAIL missing baseline: ${path.relative(repoRoot, baselinePath)} (run with --update-baseline to initialize)`)
  process.exit(1)
}
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))

const problems = []

for (const file of escapeHatches) {
  problems.push(
    `逃生口（硬零）：${file} 读取了 ALLOW_LOCALHOST / ALLOW_PRIVATE / DISABLE_SSRF 一类的 env 开关。\n`
    + '  出站安全策略不许有 env 开关——它会随包发布，而且关掉的是整个分类器。\n'
    + '  实验室的 loopback 请报精确 origin：main.ts 在 !app.isPackaged 时调 setLabTrustedPrivateOrigins。',
  )
}

for (const point of launderingPoints) {
  problems.push(
    `错误洗白（硬零）：${point} 用通用失败文案当错误兜底。\n`
    + '  这一族把「我们不知道发生了什么」印成一句和顶部状态徽标一字不差的话——零信息、零下一步，\n'
    + '  还盖掉了本可展示的线索（错误类名 / 非 Error 值的原样内容 / NOMI_ERR 机器码）。\n'
    + '  改用 src/workbench/observability/opaqueFailure.ts 的 describeOpaqueFailure(error)。',
  )
}

function diffRatchet(label, current, frozen, guidance) {
  const frozenSet = new Set(frozen ?? [])
  const currentSet = new Set(current)
  for (const file of current) {
    if (!frozenSet.has(file)) {
      problems.push(`新增${label}：${file}\n  ${guidance}`)
    }
  }
  for (const file of frozen ?? []) {
    if (!currentSet.has(file)) {
      problems.push(
        `基线陈旧：${file} 已不再${label}，请同步从 scripts/outbound-policy-baseline.json 删掉这一行\n`
        + '  （留着它等于给这个文件发了一张永久豁免票）。',
      )
    }
  }
}

diffRatchet(
  ' import appFetch',
  appFetchImporters,
  baseline.appFetchImporters,
  '这是一条**不过目的地策略**的裸出口。若这条路会拿用户/Agent/供应商给的 URL 出站，\n'
  + '  请改走 hardenedFetch（它向 networkOutboundPolicy 问同一个判据）；确实不需要策略的\n'
  + '  （本机 127.0.0.1 探测、已由上层判过的 vendor 传输），在基线里登记并写清理由。',
)

diffRatchet(
  ' import isPrivateHost',
  privateHostImporters,
  baseline.privateHostImporters,
  '目的地分类只允许有一个 owner（electron/networkOutboundPolicy.ts）。第二处分类 = 第二个判据，\n'
  + '  也就是下一次「提交放行、取回拒绝」。请改用 classifyOutboundAddresses / hardenedFetch。',
)

if (problems.length) {
  console.error('出站策略门岗 FAIL：\n')
  for (const problem of problems) console.error(`- ${problem}\n`)
  console.error(`共 ${problems.length} 条。类根因见 docs/fixes/2026-09-07-outbound-policy-split-across-submit-and-retrieval.root-cause.json`)
  process.exit(1)
}

console.log(
  `outbound policy OK — appFetch importers ${appFetchImporters.length}, isPrivateHost importers ${privateHostImporters.length}, env escape hatches 0, error laundering points 0`,
)
