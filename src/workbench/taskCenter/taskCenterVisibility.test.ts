// 任务入口是跨创作/生成/预览的常驻入口：即使重启后队列为空，用户仍要能打开任务面板和通知设置。
// 本仓没有 @testing-library/react，且这里防的是结构性回退（把旧的 return null / :has 隐藏带回来），
// 因此沿用既有源码契约测试的做法，直接守住两个会让入口消失的结构。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const read = (file: string): string => fs.readFileSync(path.join(dir, file), 'utf8')

describe('任务面板入口常驻契约', () => {
  it('空队列时仍渲染任务按钮和所属分组', () => {
    const buttonSource = read('TaskCenterButton.tsx')
    expect(buttonSource).toMatch(/export function TaskCenterButton[\s\S]*?: JSX\.Element\s*\{/)
    expect(buttonSource).not.toMatch(/return null/)

    // 10-08 外壳重设计：任务入口住 40px 合一顶栏右簇；项目内恒渲染，不靠 :has 隐藏。
    const topBarSource = read('../../ui/app-shell/shell/ShellTopBar.tsx')
    expect(topBarSource).toContain('<TaskCenterButton')
    expect(topBarSource).not.toContain('not(:has(button))')
  })
})
