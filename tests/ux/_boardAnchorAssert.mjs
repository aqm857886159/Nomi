// Read one approved artboard and the corresponding production surface after the walk opens it.
import { expect } from '@playwright/test'

function readElement(node, { text, css }) {
  const style = node.ownerDocument.defaultView.getComputedStyle(node)
  const values = {}
  if (text) values.text = node.innerText ?? node.textContent
  for (const property of css) {
    const value = style.getPropertyValue(property)
    if (!value) throw new Error(`No computed value for ${property}`)
    values[property] = value
  }
  return values
}

export async function assertBoardAnchor({ frame, page, screen = page, element, lang, theme, text = false, css = [], timeout = 5_000 }) {
  const { id, anchor } = element
  if (anchor !== `[data-board="${id}"]`) throw new Error(`Missing explicit board anchor for ${id}`)
  if (!text && !css.length) throw new Error(`No board assertion for ${id}`)
  const poll = { message: `${id} (${lang}, ${theme})`, timeout }
  await expect.poll(() => page.locator('html').evaluate(html => ({
    lang: html.lang, theme: html.getAttribute('data-mantine-color-scheme'),
  }), undefined, { timeout }), poll).toEqual({ lang, theme })
  const reference = frame.locator(anchor)
  const actual = screen.locator(anchor)
  await reference.waitFor({ state: 'visible', timeout })
  await actual.waitFor({ state: 'visible', timeout })
  const expected = await reference.evaluate(readElement, { text, css }, { timeout })
  await expect.poll(() => actual.evaluate(readElement, { text, css }, { timeout }), poll).toEqual(expected)
}
