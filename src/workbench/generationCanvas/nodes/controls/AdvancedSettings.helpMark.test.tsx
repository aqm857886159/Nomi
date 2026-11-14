// 名字旁的 ⓘ 用的是真的 Radix Tooltip（不 mock）：底栏 / 分镜行外面没有全局 TooltipProvider，
// 标记自己不带 Provider 时 Radix 直接抛错，点开「高级设置」整个生成框变成「节点生成面板加载失败」。
// 别的底栏测试把 Tooltip 整个 mock 掉了，所以这里专门不 mock、也不在外面包 Provider。
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ParameterHelpMark } from './AdvancedSettings'

describe('ParameterHelpMark', () => {
  it('外面没有 TooltipProvider 也能渲染（不让整个生成框挂掉）', () => {
    const html = renderToStaticMarkup(React.createElement(ParameterHelpMark, { name: '种子', text: '同一个种子配同样的设置，结果更接近。' }))
    expect(html).toContain('data-parameter-help="true"')
  })
})
