import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 类级检查（逃逸 FB-20261005-01-open-render）：画布媒体占位的扫光动画只许挂在「正在加载」（拿到槽位）的占位上。
// 每张排队卡都扫光时，打开大项目的第一帧要栅格上百条动画（实测可见 180 张、首帧 GPU 栅格约 330ms），
// 媒体调度等两帧画完才放第一张图，于是「节点挂上 → 第一张图」被拖到约 900ms。
// 清单从源码普查得来，不手抄：①src 下所有样式表里，选择器碰到占位类且带 animation 的每一条规则；
// ②src 下所有渲染占位组件 / 直接写占位类的地方。新加一处扫光或一处占位，都会自动进这份清单被核对。
const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const PLACEHOLDER_CLASS = 'generation-canvas-v2-node__media-loading'
const ACTIVE_ONLY = "[data-media-state='loading']"

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(file, out)
    else out.push(file)
  }
  return out
}
const files = walk(srcRoot)
const rel = (file: string) => path.relative(srcRoot, file).split(path.sep).join('/')

/** 普查①：每条 CSS 规则（选择器 + 声明块），只留碰到占位类、且声明里有动画的。 */
function animatedPlaceholderRules(): Array<{ file: string; selector: string }> {
  const rules: Array<{ file: string; selector: string }> = []
  for (const file of files.filter((candidate) => candidate.endsWith('.css'))) {
    const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const [selectorText, body] = [match[1].trim(), match[2]]
      if (!selectorText.includes(PLACEHOLDER_CLASS) || !/\banimation(?:-name)?\s*:/.test(body)) continue
      for (const selector of selectorText.split(',').map((part) => part.trim()).filter(Boolean)) rules.push({ file: rel(file), selector })
    }
  }
  return rules
}

/** 普查②：所有渲染占位的地方（组件用法与直接写类名）。 */
function placeholderRenderSites(): Array<{ file: string; line: string }> {
  const sites: Array<{ file: string; line: string }> = []
  for (const file of files.filter((candidate) => /\.tsx$/.test(candidate) && !/\.test\./.test(candidate))) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (line.includes('<DeferredNodeMediaPlaceholder') || (line.includes(`'${PLACEHOLDER_CLASS}'`) && line.includes('<'))) sites.push({ file: rel(file), line: line.trim() })
    }
  }
  return sites
}

describe('media placeholder shimmer only runs on media that is actually loading', () => {
  it('the census finds the shimmer rule and the render sites (otherwise it proves nothing)', () => {
    expect(animatedPlaceholderRules().length).toBeGreaterThan(0)
    expect(placeholderRenderSites().length).toBeGreaterThanOrEqual(2)
  })

  it('every animated rule that touches the placeholder is scoped to the loading state', () => {
    for (const rule of animatedPlaceholderRules()) {
      expect(rule.selector, `${rule.file}: ${rule.selector}`).toContain(ACTIVE_ONLY)
    }
  })

  it('every place that renders a placeholder tells it the media state', () => {
    for (const site of placeholderRenderSites()) {
      expect(site.line, `${site.file}: ${site.line}`).toMatch(/state=\{|data-media-state=\{/)
    }
  })
})
