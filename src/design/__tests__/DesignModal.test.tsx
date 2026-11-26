// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MantineProvider } from '@mantine/core'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DesignModal, type DesignModalProps } from '../overlays'
import { LONG_TITLE, expectWrappingTitle } from './modalTitleAssertions'

let root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  root = createRoot(document.body.appendChild(document.createElement('div')))
})
afterEach(() => {
  act(() => root.unmount())
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

function mount(props: Partial<DesignModalProps>) {
  act(() => root.render(<MantineProvider env="test">
    <DesignModal opened onClose={() => undefined} title={LONG_TITLE} {...props} />
  </MantineProvider>))
}

const badClasses = () => ({
  title: 'text-lg font-semibold truncate !whitespace-nowrap md:hover:!text-ellipsis [&:focus]:line-clamp-2 focus:!overflow-hidden lg:[white-space:nowrap]',
  header: 'px-4',
})
const badStyles = {
  title: { whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', overflowWrap: 'normal', letterSpacing: '2px' },
  header: { paddingTop: 12 },
} as const

it.each([
  ['展开函数结果', { classNames: { ...badClasses() } }],
  ['Mantine classNames 回调', { classNames: badClasses }],
] as const)('%s：去掉截断类并保留排版和其他插槽', (_, props) => {
  mount(props)
  const heading = expectWrappingTitle('text-lg font-semibold')
  expect(heading.closest('header')?.classList.contains('px-4')).toBe(true)
})

it.each([
  ['对象', badStyles],
  ['Mantine styles 回调', () => badStyles],
] as const)('%s：内联样式不能覆盖折行，字距与标题栏内边距照常生效', (_, styles) => {
  mount({ styles })
  const heading = expectWrappingTitle()
  expect(heading.style.overflowWrap).toBe('anywhere')
  expect(heading.style.letterSpacing).toBe('2px')
  expect(heading.closest('header')?.style.paddingTop).toBe('12px')
})

it('类与内联样式同时覆盖标题', () => {
  mount({ classNames: badClasses(), styles: badStyles })
  const heading = expectWrappingTitle('text-lg font-semibold')
  expect(heading.style.overflowWrap).toBe('anywhere')
  expect(heading.style.letterSpacing).toBe('2px')
})

// 自检：相同的 DOM 判据必须能抓住插槽内的间接包裹，同时放行兄弟节点的省略。
it('slots.header 经 props.name 包住 h2 时，断言能定位祖先上的任意变体', () => {
  const Name = (props: { name: React.ReactNode; className: string }) => <span className={props.className}>{props.name}</span>
  const slots = { header: (name: React.ReactNode) => <Name className="md:[&_h2]:!truncate" name={name} /> }
  mount({ header: slots.header })
  expect(() => expectWrappingTitle()).toThrow(/md:\[&_h2\]:!truncate/)
  mount({ header: name => <><Name className="font-medium" name={name} /><span className="truncate">模型名</span></> })
  expectWrappingTitle()
})
