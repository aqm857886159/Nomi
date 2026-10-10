import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GROUP_COLOR_IDS } from './groupColor'

// 10-10 拍板 D4：组底色用 token 的 soft 色（亮 / 暗各一套），token-only，不用行内 style 与 color-mix 拼色。
const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../../..')
const read = (rel: string) => fs.readFileSync(path.join(repo, rel), 'utf8')

const tailwind = read('tailwind.config.ts')
const tokensCss = read('src/theme/nomi-tokens.css')

/** 亮 / 暗两个 token 段（tailwind.config.ts 里 light 在前、dark 在后，以 --nomi-group-neutral 为锚）。 */
function themeBlocks(source: string): { light: string; dark: string } {
  const anchors = [...source.matchAll(/'--nomi-group-neutral': /g)].map((m) => m.index ?? 0)
  expect(anchors.length, 'tailwind 里应有亮 / 暗两段组色 token').toBe(2)
  const [first, second] = anchors
  return { light: source.slice(first, second), dark: source.slice(second, second + 1200) }
}

function cssBlocks(source: string): { light: string; dark: string } {
  const anchors = [...source.matchAll(/--nomi-group-neutral: /g)].map((m) => m.index ?? 0)
  expect(anchors.length, 'nomi-tokens.css 里应有亮 / 暗两段组色 token').toBe(2)
  const [first, second] = anchors
  return { light: source.slice(first, second), dark: source.slice(second, second + 1200) }
}

describe('group soft color tokens (10-10 D4)', () => {
  it('every color id has a soft token in both the light and dark theme (tailwind source)', () => {
    const { light, dark } = themeBlocks(tailwind)
    for (const id of GROUP_COLOR_IDS) {
      expect(light, `light ${id}-soft`).toMatch(new RegExp(`'--nomi-group-${id}-soft': 'oklch\\(`))
      expect(dark, `dark ${id}-soft`).toMatch(new RegExp(`'--nomi-group-${id}-soft': 'oklch\\(`))
      expect(tailwind, `tailwind color ${id}-soft mapped`).toContain(`'group-${id}-soft': tokenColor('--nomi-group-${id}-soft')`)
    }
  })

  it('the CSS variable mirror carries the same soft tokens in both themes', () => {
    const { light, dark } = cssBlocks(tokensCss)
    for (const id of GROUP_COLOR_IDS) {
      expect(light, `css light ${id}-soft`).toMatch(new RegExp(`--nomi-group-${id}-soft: oklch\\(`))
      expect(dark, `css dark ${id}-soft`).toMatch(new RegExp(`--nomi-group-${id}-soft: oklch\\(`))
    }
  })

  it('the soft tokens are not fake (no color-mix in the source definitions)', () => {
    const { light, dark } = themeBlocks(tailwind)
    for (const id of GROUP_COLOR_IDS) {
      const line = (block: string) => block.split('\n').find((l) => l.includes(`--nomi-group-${id}-soft`)) ?? ''
      expect(line(light)).not.toContain('color-mix')
      expect(line(dark)).not.toContain('color-mix')
    }
  })

  it('group chrome components write no inline style colors (token class names only)', () => {
    const files = [
      'src/workbench/generationCanvas/components/GroupFrame.tsx',
      'src/workbench/generationCanvas/components/GroupFrameHeader.tsx',
      'src/workbench/generationCanvas/components/CollapsedGroupCard.tsx',
      'src/workbench/generationCanvas/model/groupColor.ts',
    ]
    for (const file of files) {
      const source = read(file)
      expect(source, `${file} inline background`).not.toMatch(/style=\{\{[^}]*(background|backgroundColor|color|borderColor)\s*:/)
      expect(source, `${file} inline color-mix`).not.toContain('color-mix(')
      expect(source, `${file} hex literal`).not.toMatch(/['"]#[0-9a-fA-F]{3,8}['"]/)
    }
  })
})
