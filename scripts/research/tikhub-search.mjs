#!/usr/bin/env node
/**
 * TikHub 自媒体检索 CLI —— 调研 agent 与「反方 agent · 先查别人」的必用信息源。
 *
 * 用法：
 *   node scripts/research/tikhub-search.mjs --q "<关键词>" \
 *     [--platform douyin|xhs|bilibili|x|all] [--limit 20] [--since 2026-01-01] \
 *     --out docs/research/<date>-<topic>/tikhub/
 *
 * 产出两份（同一份数据的两个面）：
 *   - `tikhub-search.json`：结构化，给下游脚本/对账用
 *   - `tikhub-search.md`：人读摘要，直接贴进调研文档的「自媒体来源」一节
 *
 * ── 密钥纪律 ──
 * key 只从环境变量 `TIKHUB_API_KEY` 读；不接受 `--key` 参数（命令行会进 shell 历史、
 * 进 CI 日志、进截图）。缺 key = 明报「今天没查成」并 exit 2，**绝不静默返回空结果**。
 *
 * 契约来源见 `docs/research/tikhub-api-notes.md`（R5，2026-09-06 实读 openapi.json）。
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  DEFAULT_BASE_URL,
  TikHubConfigError,
  TikHubHttpError,
  readApiKey,
  renderMarkdown,
  resolvePlatforms,
  searchPlatform,
  summarizeResults,
} from './tikhub-search-lib.mjs'

const USAGE = `用法：node scripts/research/tikhub-search.mjs --q "<关键词>" [--platform douyin|xhs|bilibili|x|all] [--limit 20] [--since 2026-01-01] --out <dir>

  --q, --query   必填，搜索关键词
  --platform     默认 all；可逗号分隔（douyin,xhs）
  --limit        每个平台最多几条，默认 20
  --since        只要这个日期之后发布的（YYYY-MM-DD）
  --out          必填，产物目录；约定 docs/research/<date>-<topic>/tikhub/
  --base-url     默认 ${DEFAULT_BASE_URL}（中国大陆用 https://api.tikhub.dev）

  密钥只从环境变量 TIKHUB_API_KEY 读，不接受命令行传入。`

/** 只认识写死的这几个 flag：不认识的参数一律报错，免得打错字被静默忽略。 */
export function parseArgs(argv) {
  const options = { platform: 'all', limit: 20, since: null, out: null, query: null, baseUrl: DEFAULT_BASE_URL }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = () => {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) throw new TikHubConfigError(`${arg} 缺少取值`)
      index += 1
      return value
    }
    switch (arg) {
      case '--q':
      case '--query': options.query = next(); break
      case '--platform': options.platform = next(); break
      case '--limit': options.limit = Number.parseInt(next(), 10); break
      case '--since': options.since = next(); break
      case '--out': options.out = next(); break
      case '--base-url': options.baseUrl = next(); break
      case '--help':
      case '-h': options.help = true; break
      default: throw new TikHubConfigError(`不认识的参数：${arg}\n\n${USAGE}`)
    }
  }
  if (options.help) return options
  if (!options.query) throw new TikHubConfigError(`缺少 --q "<关键词>"\n\n${USAGE}`)
  if (!options.out) throw new TikHubConfigError(`缺少 --out <dir>\n\n${USAGE}`)
  if (!Number.isFinite(options.limit) || options.limit <= 0) throw new TikHubConfigError('--limit 必须是正整数')
  if (options.since !== null && Number.isNaN(Date.parse(options.since))) {
    throw new TikHubConfigError(`--since 不是合法日期：${options.since}（要 YYYY-MM-DD）`)
  }
  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }

  const apiKey = readApiKey(process.env)
  const platforms = resolvePlatforms(options.platform)
  const sinceMs = options.since ? Date.parse(options.since) : null
  const nowMs = Date.now()
  const generatedAt = new Date(nowMs).toISOString()

  const results = []
  const failures = []
  for (const platform of platforms) {
    process.stderr.write(`▶ ${platform.label} 检索「${options.query}」…\n`)
    try {
      const group = await searchPlatform({
        platform,
        keyword: options.query,
        limit: options.limit,
        sinceMs,
        nowMs,
        apiKey,
        baseUrl: options.baseUrl,
        onRetry: ({ attempt, delayMs, status }) =>
          process.stderr.write(`  ↻ 第 ${attempt} 次失败（${status ?? '网络'}），${delayMs}ms 后重试\n`),
      })
      results.push(group)
      process.stderr.write(`  ✓ ${group.records.length} 条（翻了 ${group.pages.length} 页）\n`)
    } catch (error) {
      // 一个平台挂掉不该让整轮白跑，但**必须留痕并影响退出码**——静默少一个平台
      // 和「这个平台今天没人聊」在报告里长得一样。
      const reason = error instanceof TikHubHttpError ? `HTTP ${error.status}: ${error.bodyText}` : error.message
      failures.push({ platform: platform.id, reason })
      results.push({ platform: platform.id, platformLabel: platform.label, records: [], pages: [], error: reason })
      process.stderr.write(`  ✗ ${platform.label} 失败：${reason}\n`)
    }
  }

  const outDir = path.resolve(process.cwd(), options.out)
  fs.mkdirSync(outDir, { recursive: true })
  const bundle = {
    source: 'tikhub',
    baseUrl: options.baseUrl,
    keyword: options.query,
    since: options.since,
    limitPerPlatform: options.limit,
    generatedAt,
    failures,
    // 摘要放在 results 之前：调用方（含 agent）第一眼就该看到「这轮靠不靠谱」，
    // 而不是先读完几百条 records 才发现某个平台其实是空的。
    summary: summarizeResults(results),
    results,
  }
  const jsonPath = path.join(outDir, 'tikhub-search.json')
  const mdPath = path.join(outDir, 'tikhub-search.md')
  fs.writeFileSync(jsonPath, `${JSON.stringify(bundle, null, 2)}\n`)
  fs.writeFileSync(mdPath, renderMarkdown({ keyword: options.query, since: options.since, generatedAt, results }))

  const { totalRecords, platforms: summaryRows } = bundle.summary
  process.stdout.write(`${jsonPath}\n${mdPath}\n`)
  for (const row of summaryRows) {
    const missing = Object.entries(row.missingFields)
      .map(([field, count]) => `${field}×${count}`)
      .join('、')
    process.stdout.write(`  ${row.status === 'ok' ? '✓' : row.status === 'empty' ? '⚠️' : '✗'} ${row.platformLabel}：${row.items} 条${missing ? ` · 缺字段 ${missing}` : ''}${row.error ? ` · ${row.error}` : ''}\n`)
  }
  process.stdout.write(`共 ${totalRecords} 条${failures.length > 0 ? `（${failures.length} 个平台失败）` : ''}\n`)
  return failures.length === platforms.length && platforms.length > 0 ? 3 : 0
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href
if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      if (error instanceof TikHubConfigError) {
        process.stderr.write(`✖ ${error.message}\n`)
        process.exit(2)
      }
      process.stderr.write(`✖ ${error?.message ?? error}\n`)
      process.exit(3)
    })
}
