import { expect } from 'vitest'

export const LONG_TITLE = '为这组分镜生成AnotherHighDefinitionVersionWithoutReplacingTheOriginalStoryboard请保留当前版本并确认全部镜头的最终标题'

export function expectWrappingTitle(typography = ''): HTMLHeadingElement {
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]')
  expect(dialogs).toHaveLength(1)
  const dialog = dialogs[0]
  const heading = document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')
  if (!(heading instanceof HTMLHeadingElement) || heading.tagName !== 'H2' || !dialog.contains(heading)) {
    throw new Error('aria-labelledby 必须指向弹窗内的 h2')
  }
  expect(heading.textContent).toBe(LONG_TITLE)
  for (let element: HTMLElement | null = heading; element; element = element.parentElement) {
    for (const token of element.classList) {
      expect(token).not.toMatch(/(?:^|:)!?(?:truncate|text-ellipsis|whitespace-nowrap|line-clamp-(?!none$).+)$/)
    }
    if (element === dialog) break
  }
  expect(heading.className).not.toMatch(/(?:^|[\s:])!?(?:overflow(?:-[xy])?-(?:hidden|clip)|\[white-space:nowrap\])(?=\s|$)/)
  expect(heading.style.whiteSpace).not.toBe('nowrap')
  expect(heading.style.textOverflow).not.toBe('ellipsis')
  expect(heading.style.overflow).not.toBe('hidden')
  if (typography) expect([...heading.classList]).toEqual(expect.arrayContaining(typography.split(' ')))
  return heading
}
