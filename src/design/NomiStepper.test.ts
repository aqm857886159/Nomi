import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NomiStepper } from './identity'

// 10-09 回归：顶栏步骤器把进度（「生成 5/6」「预览 0:26」）放进按钮之后，按钮的无障碍名跟着变成
// 「生成 5/6」——读屏念一串数字，按名字找这一步的走查（getByRole('button', { name: '生成', exact: true })）全部落空。
// 合同：名字只是阶段名；进度是附属信息，aria-hidden，只进 title。
describe('NomiStepper 的无障碍名不吃进度', () => {
  const markup = renderToStaticMarkup(React.createElement(NomiStepper, {
    value: 'generation',
    onChange: () => undefined,
    meta: { generation: '5/6', preview: '0:26' },
  }))

  it('有进度的那一步，aria-label 仍只是阶段名，进度 span 不进无障碍树', () => {
    const generationButton = /<button[^>]*data-mode="generation"[^>]*>/.exec(markup)?.[0] ?? ''
    expect(generationButton).toMatch(/aria-label="[^"\d]+"/)
    expect(markup).toContain('data-stepper-meta="generation" aria-hidden="true"')
  })

  it('进度留在 title 里（悬停看得到）', () => {
    expect(markup).toMatch(/data-mode="generation"[^>]*title="[^"]*5\/6"|title="[^"]*5\/6"[^>]*data-mode="generation"/)
  })
})
