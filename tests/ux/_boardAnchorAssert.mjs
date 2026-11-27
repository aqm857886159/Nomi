// Read one approved artboard and the corresponding production surface after the walk opens it.
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect } from '@playwright/test'

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Read the approved artboard exclusively from committed Git objects:
 * - prefer merge-base(HEAD, origin/main) whenever that artboard already carries data-board="<id>";
 * - otherwise read HEAD:<path> (the committed PR head bound to coordApprovals), never uncommitted disk files;
 * - fail closed if merge-base or the committed artboard cannot be resolved.
 */
export function readApprovedBoardHtml(boardHtmlPath, elementId, { repoRoot = defaultRepoRoot, git } = {}) {
  const runGit = git ?? ((args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }))
  const relPath = path.relative(repoRoot, boardHtmlPath).split(path.sep).join('/')
  if (!relPath || relPath.startsWith('..')) throw new Error(`Board preview must reside inside repository: ${boardHtmlPath}`)
  const needle = `data-board="${elementId}"`
  const base = String(runGit(['merge-base', 'HEAD', 'origin/main'])).trim()
  if (!base) throw new Error(`Cannot resolve merge-base(HEAD, origin/main) for ${relPath}`)
  let source = null
  try {
    const candidate = String(runGit(['show', `${base}:${relPath}`]))
    if (candidate.includes(needle)) source = candidate
  } catch { /* file not yet on base */ }
  if (source === null) {
    const committedHead = String(runGit(['show', `HEAD:${relPath}`]))
    if (!committedHead.includes(needle)) throw new Error(`Committed HEAD:${relPath} does not contain ${needle}`)
    source = committedHead
  }
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
