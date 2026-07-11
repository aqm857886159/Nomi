// 不变量：workbench 内禁止裸 r3f <Canvas>——必须经 FencedCanvas（就地 Suspense 围栏）。
// 依据：r3f Canvas 初始化期自我 suspend；裸挂载会冒泡到最近 DOM Suspense，React 18 把该边界
// 已提交的整棵子树 display:none（2026-07-11 「3D 编辑器冷开隐身 1.8s+」悬案根因）。
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WORKBENCH_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..', 'workbench')
const ALLOWED = new Set(['generationCanvas/nodes/fencedCanvas.tsx'])

function collectTsx(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) collectTsx(full, out)
    else if (full.endsWith('.tsx')) out.push(full)
  }
  return out
}

describe('FencedCanvas 不变量', () => {
  it('workbench 内除 fencedCanvas.tsx 外没有裸 <Canvas>（@react-three/fiber）', () => {
    const offenders: string[] = []
    for (const file of collectTsx(WORKBENCH_ROOT)) {
      const text = readFileSync(file, 'utf8')
      if (!text.includes("from '@react-three/fiber'")) continue
      if (!/<Canvas[\s>]/.test(text)) continue
      const rel = path.relative(WORKBENCH_ROOT, file)
      if (!ALLOWED.has(rel)) offenders.push(rel)
    }
    expect(offenders, '裸 <Canvas> 会在初始化 suspend 时把宿主表面整棵 display:none，改用 FencedCanvas').toEqual([])
  })
})
