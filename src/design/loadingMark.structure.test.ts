// 守卫（I-persona-guards）：加载标不换形象脸。
// 形象拍板 docs/design/boards/2026-10-27-agent-persona/AgentPersona.board.json 的 Q10：
// 「App 图标、营销字标、全仓加载标（NomiLoadingMark）不换；只换右下小球和聊天身份行。」
// 验收时发现这条边界没有任何东西拦：把 NomiLoadingMark 换成 NomiAgentFace，全仓全绿。
// 两道结构判据：① NomiLoadingMark 的实现不引用形象脸；② 形象脸只被「右下小球」和「聊天身份行」两个文件画出来（普查）。
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [full] : []
  })
}

describe('加载标不换形象脸（Q10）', () => {
  it('NomiLoadingMark 的实现只用品牌 logo 标，不引用形象脸', () => {
    const source = stripComments(fs.readFileSync(path.join(process.cwd(), 'src/design/identity.tsx'), 'utf8'))
    const start = source.indexOf('export function NomiLoadingMark')
    expect(start, '找不到 NomiLoadingMark').toBeGreaterThanOrEqual(0)
    const end = source.indexOf('\nexport ', start + 1)
    const body = source.slice(start, end < 0 ? undefined : end)
    expect(body).toContain('NomiLogoMark')
    expect(body).not.toMatch(/NomiAgentFace|AgentFace|NOMI_AGENT_POSES/)
  })

  it('形象脸只被右下小球和聊天身份行画出来（别处当加载标 / 装饰用就红）', () => {
    const users = walk(path.join(process.cwd(), 'src'))
      .filter((file) => !file.includes(`${path.sep}devlab${path.sep}`))
      .filter((file) => /<NomiAgentFace\b/.test(stripComments(fs.readFileSync(file, 'utf8'))))
      .map((file) => path.relative(process.cwd(), file).split(path.sep).join('/'))
      .sort()
    expect(users).toEqual(['src/ui/app-shell/shell/AgentBallFace.tsx', 'src/workbench/ai/NomiIdentityRow.tsx'])
  })
})
