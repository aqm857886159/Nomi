/**
 * 结构守卫（方案 §6.5）：编译器不知道手改覆盖层。从编译器目录的每个源文件出发，沿静态 import（含 type import、
 * 动态 import 的字面路径）走完整张图，覆盖层模块一个都不许够到——编译器读到手改，就会把「用户的手」编进计划结果，
 * 下一次覆盖层再叠一遍，手改被算两次。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))
const compilerDir = path.join(here, 'compiler')
const overlayFile = path.join(here, 'planOverrides.ts')
const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g

function resolve(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const base = path.resolve(path.dirname(from), spec)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')])
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  return null
}

function reachable(entries: string[]): Set<string> {
  const seen = new Set<string>()
  const queue = [...entries]
  while (queue.length) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    for (const match of fs.readFileSync(file, 'utf8').matchAll(IMPORT)) {
      const next = resolve(file, match[1] ?? match[2])
      if (next && !seen.has(next)) queue.push(next)
    }
  }
  return seen
}

describe('编译器不读覆盖层', () => {
  it('从编译器目录出发的静态依赖图里没有 planOverrides', () => {
    const entries = fs.readdirSync(compilerDir).filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)).map((name) => path.join(compilerDir, name))
    expect(entries.length).toBeGreaterThan(3)
    const graph = reachable(entries)
    expect(graph.size).toBeGreaterThan(entries.length) // 真的走出了目录（守卫不是空转）
    expect([...graph].map((file) => path.normalize(file))).not.toContain(path.normalize(overlayFile))
  })

  it('守卫自己会响：同一套走法从执行体出发能走到覆盖层', () => {
    const executor = path.join(here, '..', 'agent', 'applyDirectorWrite.ts')
    expect([...reachable([executor])].map((file) => path.normalize(file))).toContain(path.normalize(overlayFile))
  })
})
