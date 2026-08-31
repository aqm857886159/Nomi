import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// 这道红灯专门钉住上一轮的根因：媒体是真供应商生成，但 Run/剧本/分镜的状态
// 是脚本自己 writeJson + source='external-mcp' + reviewStatus='approved' 写出来的，
// 这不能作为 MCP/ProductionRun 的黑盒验收。
//
// 下一轮只能由真实 MCP tool sequence 产生；旧媒体脚本已移入 benchmarks/，
// 只能作为冻结的质量基准，不允许继续被当作产品入口。
// start → get/events → decide direction → read/review script → read/review storyboard
// → materialize；本测试不生成媒体，也不允许把这条旧脚本当入口复用。

const repoRoot = path.resolve(process.cwd())
const productionEntrypoints = [
  'scripts/production-run.mjs',
  'scripts/productionRun.mjs',
]
const benchmarkEntrypoints = [
  'scripts/benchmarks/build-agentic-draft-film.mjs',
  'scripts/benchmarks/run-real-30s-continuity-film.mjs',
]

describe('ProductionRun black-box entrypoint', () => {
  it('does not manufacture a Run or call generate outside the MCP/ProductionRun seam', () => {
    const violations = []
    for (const relativePath of productionEntrypoints) {
      const file = path.join(repoRoot, relativePath)
      if (!fs.existsSync(file)) continue
      const source = fs.readFileSync(file, 'utf8')
      if (/writeJson\(path\.join\([^\n]+['"]run\.json['"]\)/.test(source)) {
        violations.push(`${relativePath}: writes run.json directly`)
      }
      if (/reviewStatus:\s*['"]approved['"]/.test(source)) {
        violations.push(`${relativePath}: self-approves an artifact`)
      }
      if (/source:\s*['"]external-mcp['"]/.test(source)) {
        violations.push(`${relativePath}: labels a hand-written file as external-mcp`)
      }
      if (/invoke\(['"]generate['"]/.test(source)) {
        violations.push(`${relativePath}: calls low-level generate instead of nomi MCP ProductionRun jobs`)
      }
    }
    for (const relativePath of benchmarkEntrypoints) {
      const file = path.join(repoRoot, relativePath)
      if (!fs.existsSync(file)) continue
      const source = fs.readFileSync(file, 'utf8')
      if (!/BENCHMARK_ONLY/.test(source)) violations.push(`${relativePath}: benchmark is not explicitly marked benchmark-only`)
    }
    expect(violations, `legacy production entrypoints must be retired:\n${violations.join('\n')}`).toEqual([])
  })
})
