/** DOM geometry only: no product imports, selectors, baseline or throwing policy. */
export const DEFAULT_RULES = {
  overlapArea: 4,
  minFontSize: 12,
  viewport: true,
  clipping: true,
  hittable: true,
  interactiveTags: ['BUTTON', 'A', 'CANVAS', 'INPUT', 'SELECT', 'TEXTAREA'],
}

export async function scanFeel(root, { rules = {}, label = 'page' } = {}) {
  // Page.evaluate and Locator.evaluate have different argument contracts.
  const scope = typeof root.locator === 'function' && typeof root.goto === 'function'
    ? root.locator('html')
    : root
  return scope.evaluate((boundary, { config, label }) => {
    const doc = boundary.ownerDocument
    const view = doc.defaultView
    const viewport = { left: 0, top: 0, right: view.innerWidth, bottom: view.innerHeight }
    const intersect = (a, b) => ({
      left: Math.max(a.left, b.left), top: Math.max(a.top, b.top),
      right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom),
    })
    const area = (r) => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top)
    const documentStyle = view.getComputedStyle(doc.documentElement)
    const bodyStyle = doc.body ? view.getComputedStyle(doc.body) : documentStyle
    const scrollRoot = doc.scrollingElement || doc.documentElement
    const documentClip = {
      left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity,
    }
    if (scrollRoot.scrollHeight > view.innerHeight && !/hidden|clip/.test(documentStyle.overflowY + bodyStyle.overflowY)) {
      documentClip.top = 0
      documentClip.bottom = view.innerHeight
    }
    if (scrollRoot.scrollWidth > view.innerWidth && !/hidden|clip/.test(documentStyle.overflowX + bodyStyle.overflowX)) {
      documentClip.left = 0
      documentClip.right = view.innerWidth
    }
    const findings = []
    const report = (rule, elements) => findings.push({
      rule,
      target: elements.map((el) => el.tagName.toLowerCase()),
      text: elements.map((el) => el.textContent.trim().slice(0, 80)),
      rects: elements.map((el) => el.getBoundingClientRect().toJSON()),
      fontSizes: elements.map((el) => parseFloat(view.getComputedStyle(el).fontSize)),
    })

    function visibleRect(el, rect = el.getBoundingClientRect(), clipSelf = false) {
      let visible = intersect(rect, documentClip)
      for (let parent = clipSelf ? el : el.parentElement; parent; parent = parent.parentElement) {
        const style = view.getComputedStyle(parent)
        if (style.visibility === 'hidden' || Number(style.opacity) === 0) return null
        const box = parent.getBoundingClientRect()
        // Clip each axis independently: ordinary offscreen scroll content is not a defect.
        const clip = {
          left: /auto|scroll|hidden|clip/.test(style.overflowX) ? box.left + parent.clientLeft : -Infinity,
          right: /auto|scroll|hidden|clip/.test(style.overflowX) ? box.left + parent.clientLeft + parent.clientWidth : Infinity,
          top: /auto|scroll|hidden|clip/.test(style.overflowY) ? box.top + parent.clientTop : -Infinity,
          bottom: /auto|scroll|hidden|clip/.test(style.overflowY) ? box.top + parent.clientTop + parent.clientHeight : Infinity,
        }
        // The document scroller is the viewport owner, not a nested scroller.
        if (parent !== doc.documentElement && parent !== doc.body) visible = intersect(visible, clip)
      }
      return area(visible) > 0 ? visible : null
    }

    const elements = [boundary, ...boundary.querySelectorAll('*')].filter((el) => {
      const style = view.getComputedStyle(el)
      return style.display !== 'none' && style.visibility !== 'hidden'
        && Number(style.opacity) > 0 && visibleRect(el)
    })
    // Text ranges avoid treating a full-width block's empty space as painted text.
    const texts = elements.flatMap((el) => [...el.childNodes]
      .filter((node) => node.nodeType === 3 && node.textContent.trim())
      .flatMap((node) => {
        const range = doc.createRange()
        range.selectNodeContents(node)
        return [...range.getClientRects()].map((rect) => ({ el, rect: visibleRect(el, rect, true) }))
          .filter(({ rect }) => rect && area(intersect(rect, viewport)) > 0)
      }))

    function textOverlap() {
      const buckets = new Map()
      const seen = new Set()
      const cellSize = 128
      texts.forEach((item, index) => {
        const r = intersect(item.rect, viewport)
        for (let x = Math.floor(r.left / cellSize); x <= Math.floor(r.right / cellSize); x++) {
          for (let y = Math.floor(r.top / cellSize); y <= Math.floor(r.bottom / cellSize); y++) {
            const key = `${x}:${y}`
            const neighbors = buckets.get(key) || []
            for (const otherIndex of neighbors) {
              const pair = `${otherIndex}:${index}`
              if (seen.has(pair)) continue
              seen.add(pair)
              const other = texts[otherIndex]
              if (other.el.contains(item.el) || item.el.contains(other.el)) continue
              if (area(intersect(item.rect, other.rect)) > config.overlapArea) {
                report('text-overlap', [other.el, item.el])
              }
            }
            neighbors.push(index)
            buckets.set(key, neighbors)
          }
        }
      })
    }

    function outOfViewport(el) {
      const r = visibleRect(el)
      if (r && area(intersect(r, viewport)) < area(r)) report('out-of-viewport', [el])
    }

    function clippedContent(el) {
      const style = view.getComputedStyle(el)
      if ((el.scrollHeight > el.clientHeight + 1 && /hidden|clip/.test(style.overflowY))
        || (el.scrollWidth > el.clientWidth + 1 && /hidden|clip/.test(style.overflowX))) {
        report('clipped-content', [el])
      }
    }

    function fontSize(el) {
      const hasOwnText = [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())
      if (hasOwnText && parseFloat(view.getComputedStyle(el).fontSize) < config.minFontSize) report('font-size', [el])
    }

    function unreachableInteraction(el) {
      if (!config.interactiveTags.includes(el.tagName) || el.disabled) return
      if (view.getComputedStyle(el).pointerEvents === 'none') report('unreachable-interaction', [el])
    }

    function blockedInteraction(el) {
      if (!config.interactiveTags.includes(el.tagName) || el.disabled) return
      if (view.getComputedStyle(el).pointerEvents === 'none') return
      const r = intersect(visibleRect(el), viewport)
      if (area(r) <= 0) return
      const hit = doc.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2)
      if (!hit || !(hit === el || el.contains(hit))) report('blocked-interaction', [el])
    }

    const rules = [
      { enabled: config.viewport, run: outOfViewport },
      { enabled: config.clipping, run: clippedContent },
      { enabled: config.minFontSize > 0, run: fontSize },
      { enabled: config.hittable, run: unreachableInteraction },
      { enabled: config.hittable, run: blockedInteraction },
    ]
    if (config.overlapArea !== false) textOverlap()
    for (const el of elements) for (const rule of rules) if (rule.enabled) rule.run(el)
    return { label, findings }
  }, { config: { ...DEFAULT_RULES, ...rules }, label })
}

export const formatFeelFindings = (result) => JSON.stringify(result, null, 2)

/** Disclosure text hierarchy: computed OKLCH lightness and weight, never token names.
 * Callers declare semantic exceptions (status, timestamps, icons) explicitly.
 */
export async function measureDisclosureHierarchy(details, { exclude = '' } = {}) {
  return details.evaluate((root, excluded) => {
    const summary = root.querySelector(':scope > summary')
    if (!summary) throw new Error('Disclosure has no direct summary')
    const lightness = color => {
      if (!/^okl(?:ch|ab)\(/.test(color)) throw new Error(`Expected computed OKLab/OKLCH color, got ${color}`)
      const token = color.match(/\(\s*([\d.]+)(%?)/)
      return Number(token[1]) / (token[2] ? 100 : 1)
    }
    const headline = getComputedStyle(summary)
    const reference = { lightness: lightness(headline.color), weight: Number(headline.fontWeight) }
    const rows = [...root.querySelectorAll('*')].filter(el =>
      el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden'
      && !(excluded && el.closest(excluded))
      && [...el.childNodes].some(node => node.nodeType === 3 && node.textContent.trim()),
    ).map(el => {
      const style = getComputedStyle(el)
      return { text: el.textContent.trim().slice(0, 80), lightness: lightness(style.color), weight: Number(style.fontWeight) }
    })
    if (!rows.length) throw new Error('Disclosure hierarchy probe has no text')
    return { reference, rows, violations: rows.filter(row => row.lightness + 0.00001 < reference.lightness || row.weight > reference.weight) }
  }, exclude)
}

/** Conservative contrast floor for badges over arbitrary media pixels.
 * Browser canvas resolves CSS colors (including OKLCH) to sRGB. Background and
 * translucent text luminance intervals include every possible media color;
 * overlapping intervals fail closed instead of assuming a white page behind it.
 */
export async function measureMediaBadgeContrast(badges, { threshold = 4.5 } = {}) {
  return badges.evaluateAll((elements, threshold) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })
    const rgba = color => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      return [...context.getImageData(0, 0, 1, 1).data].map(value => value / 255)
    }
    const over = (foreground, background) => background.map((value, index) =>
      foreground[index] * foreground[3] + value * (1 - foreground[3]))
    const luminance = rgb => rgb.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
    const rows = elements.flatMap(badge => [badge, ...badge.querySelectorAll('*')]
      .filter(element => element.getClientRects().length && [...element.childNodes]
        .some(node => node.nodeType === 3 && node.textContent.trim()))
      .map(element => {
        const layers = []
        for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
          layers.unshift(ancestor)
          if (ancestor === badge) break
        }
        let low = [0, 0, 0], high = [1, 1, 1]
        for (const layer of layers) {
          const background = rgba(getComputedStyle(layer).backgroundColor)
          low = over(background, low)
          high = over(background, high)
        }
        const foreground = rgba(getComputedStyle(element).color)
        const bgLow = luminance(low), bgHigh = luminance(high)
        const fgLow = luminance(over(foreground, low)), fgHigh = luminance(over(foreground, high))
        const opaqueLayers = layers.every(layer => Number(getComputedStyle(layer).opacity) === 1)
        const ratio = !opaqueLayers ? 1 : fgHigh < bgLow ? (bgLow + 0.05) / (fgHigh + 0.05)
          : fgLow > bgHigh ? (fgLow + 0.05) / (bgHigh + 0.05) : 1
        return { text: element.textContent.trim(), ratio, threshold }
      }))
    if (!rows.length) throw new Error('Media badge contrast probe has no visible text')
    return { rows, violations: rows.filter(row => row.ratio < threshold) }
  }, threshold)
}
