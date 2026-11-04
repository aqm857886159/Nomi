import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// 只验挂载点本身：有待确认时，卡在同一次渲染里就出来，不经过任何「先挂起等代码」的一步。
vi.mock('./spendConfirm', () => ({
  useSpendConfirmStore: (select: (state: { pending: unknown }) => unknown) => select({ pending: { title: 'title', message: 'message' } }),
}))
vi.mock('./SpendConfirmDialog', () => ({
  SpendConfirmDialog: () => <div data-spend-confirm-dialog="" />,
}))

import { SpendConfirmHost } from './SpendConfirmHost'

const SRC = path.resolve(__dirname, '../../..')

function productionSources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) productionSources(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

describe('付费确认卡：点下去的同一帧就出来', () => {
  it('有待确认时，挂载点同一次渲染就交出卡（懒加载会先挂起，React 再固定多等 300ms 才揭开）', () => {
    expect(renderToStaticMarkup(<SpendConfirmHost />)).toContain('data-spend-confirm-dialog')
  })

  it('整个 src 没有任何地方按需加载付费确认卡或它的挂载点', () => {
    const offenders = productionSources(SRC).filter(file => /import\(\s*['"][^'"]*\/SpendConfirm(Dialog|Host)['"]\s*\)/.test(fs.readFileSync(file, 'utf8')))
    expect(offenders.map(file => path.relative(SRC, file))).toEqual([])
  })

  it('工作台根组件静态引入挂载点并直接渲染它（唯一挂载点，8 个确认来源都汇到这里）', () => {
    const app = fs.readFileSync(path.join(SRC, 'workbench/NomiStudioApp.tsx'), 'utf8')
    expect(app).toMatch(/^import \{ SpendConfirmHost \} from '\.\/generationCanvas\/spend\/SpendConfirmHost'$/m)
    expect(app.match(/<SpendConfirmHost \/>/g)).toHaveLength(1)
    expect(app).not.toMatch(/<SpendConfirmDialog\b/)
  })
})
