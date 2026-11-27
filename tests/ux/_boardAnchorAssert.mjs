// Read one approved artboard and the corresponding production surface after the walk opens it.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect } from '@playwright/test'

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Prefer the approved baseline version (merge-base with origin/main) whenever that artboard
 * already carries the explicit data-board anchor, so a PR cannot pass by editing both the
 * production screen and the working-tree preview HTML. New boards/anchors not yet on main
 * fall back to disk and are gated at merge-preflight by coordApprovals (artboardFiles).
 */
export function readApprovedBoardHtml(boardHtmlPath, elementId, { repoRoot = defaultRepoRoot, git } = {}) {
  const runGit = git ?? ((args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }))
  const relPath = path.relative(repoRoot, boardHtmlPath).split(path.sep).join('/')
  const needle = `data-board="${elementId}"`
  let html = null
  if (!relPath.startsWith('..')) {
    try {
      const base = runGit(['merge-base', 'HEAD', 'origin/main']).trim()
      const candidate = base ? runGit(['show', `${base}:${relPath}`]) : ''
      if (candidate.includes(needle)) html = candidate
    } catch { /* fallback to current checkout when git base or file is absent */ }
  }
  const source = html ?? fs.readFileSync(boardHtmlPath, 'utf8')
  const baseHref = pathToFileURL(`${path.dirname(path.resolve(boardHtmlPath))}${path.sep}`).href
  return source.includes('<base ') ? source : source.replace(/<head(\b[^>]*)>/i, `<head$1><base href="${baseHref}">`)
}

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
