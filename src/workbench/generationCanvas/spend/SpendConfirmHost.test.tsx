import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { MantineProvider } from '@mantine/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// 只替换队列，卡本身是真的：有待确认时，挂载点同一次渲染就交出卡，不经过任何「先挂起等代码」的一步。
const state = vi.hoisted(() => ({
  pending: { title: 'Generate this shot?', message: 'It will use model credits.' } as unknown,
  queue: [],
  resolvePending: () => undefined,
  togglePlanRow: () => undefined,
  requestConfirm: async () => true,
}))
vi.mock('./spendConfirm', () => {
  const useSpendConfirmStore = (select: (value: typeof state) => unknown) => select(state)
  useSpendConfirmStore.getState = () => state
  return { useSpendConfirmStore }
})

import { SpendConfirmHost } from './SpendConfirmDialog'

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
  it('有待确认时，挂载点同一次渲染就交出真的卡', () => {
    // 外壳是 DesignModal（Mantine）：env="test" 让它不经 portal、直接在这次渲染里交出卡。
    const markup = renderToStaticMarkup(<MantineProvider env="test"><SpendConfirmHost /></MantineProvider>)
    expect(markup).toContain('data-spend-confirm-dialog')
    expect(markup).toContain('Generate this shot?')
  })

  it('没有待确认时不挂卡', () => {
    const pending = state.pending
    state.pending = null
    try { expect(renderToStaticMarkup(<SpendConfirmHost />)).toBe('') } finally { state.pending = pending }
  })

  it('整个 src 没有任何地方按需加载付费确认卡（懒加载会先挂起，React 再固定多等 300ms 才揭开）', () => {
    const offenders = productionSources(SRC).filter(file => /import\(\s*['"][^'"]*\/SpendConfirmDialog['"]\s*\)/.test(fs.readFileSync(file, 'utf8')))
    expect(offenders.map(file => path.relative(SRC, file))).toEqual([])
  })

  it('工作台根组件静态引入挂载点并只挂一次（所有确认来源都汇到这里），不直接挂卡', () => {
    const app = fs.readFileSync(path.join(SRC, 'workbench/NomiStudioApp.tsx'), 'utf8')
    expect(app).toMatch(/^import \{ SpendConfirmHost \} from '\.\/generationCanvas\/spend\/SpendConfirmDialog'$/m)
    expect(app.match(/<SpendConfirmHost \/>/g)).toHaveLength(1)
    expect(app).not.toMatch(/<SpendConfirmDialog\b/)
  })
})
