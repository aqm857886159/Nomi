/** DOM geometry only: no product imports, selectors, baseline or throwing policy. */
export const DEFAULT_RULES = {
  overlapArea: 4,
  minFontSize: 12,
  viewport: true,
  clipping: true,
  hittable: true,
  duplicateNearbyHeader: true,
  duplicateActionBar: true,
  duplicatePersonaStage: true,
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

    const elementSet = new Set(elements)
    const norm = (value) => (value || '').replace(/\s+/g, ' ').trim().toLowerCase()
    const interactiveControlSelector = 'button, a, input, select, textarea, label, [contenteditable="true"], [role="button"], [role="tab"], [role="menuitem"], [role="option"]'
    const paintedNodes = []
    for (const el of elements) {
      for (const node of el.childNodes) {
        if (node.nodeType !== 3 || !node.textContent.trim()) continue
        const range = doc.createRange()
        range.selectNodeContents(node)
        const rects = [...range.getClientRects()]
          .map((rect) => visibleRect(el, rect, true))
          .filter((rect) => rect && area(intersect(rect, viewport)) > 0)
        if (rects.length) paintedNodes.push({ el, text: node.textContent, rects })
      }
    }
    const unionRects = (rects) => rects.length
      ? rects.reduce((acc, r) => ({
        left: Math.min(acc.left, r.left),
        top: Math.min(acc.top, r.top),
        right: Math.max(acc.right, r.right),
        bottom: Math.max(acc.bottom, r.bottom),
      }))
      : null
    const nonInteractiveSummary = (rootEl) => {
      const parts = []
      const rects = []
      for (const item of paintedNodes) {
        if (!rootEl.contains(item.el)) continue
        const ctrl = item.el.closest(interactiveControlSelector)
        if (ctrl && rootEl.contains(ctrl)) continue
        parts.push(item.text)
        rects.push(...item.rects)
      }
      const graphicSelector = 'svg, img, [data-persona-stage]'
      for (const gfx of rootEl.querySelectorAll(graphicSelector)) {
        if (!elementSet.has(gfx)) continue
        const ctrl = gfx.closest(interactiveControlSelector)
        if (ctrl && rootEl.contains(ctrl)) continue
        const r = visibleRect(gfx)
        if (r && area(intersect(r, viewport)) > 0) rects.push(r)
      }
      return { text: norm(parts.join('')), rect: unionRects(rects), hasGraphic: [...rootEl.querySelectorAll(graphicSelector)].some((gfx) => elementSet.has(gfx) && !(gfx.closest(interactiveControlSelector) && rootEl.contains(gfx.closest(interactiveControlSelector)))) }
    }

    function duplicateNearbyHeader() {
      const headingSelector = 'h1, h2, h3, h4, h5, h6, [role="heading"], strong'
      const headers = elements.filter((el) => el.matches('header, [role="banner"]'))
      headers.forEach((header, headerIndex) => {
        if (view.getComputedStyle(header).position === 'absolute') return
        const hRect = visibleRect(header)
        const parent = header.parentElement
        const pRect = parent ? visibleRect(parent) : null
        if (!hRect || !pRect || hRect.height > 64 || hRect.top < pRect.top - 2) return
        const units = new Map()
        for (const u of [header, ...header.querySelectorAll('*')]) {
          if (!elementSet.has(u) || u.closest(interactiveControlSelector)) continue
          const info = nonInteractiveSummary(u)
          if (info.text.length < 2 || info.text.length > 32 || !info.rect) continue
          const w = info.rect.right - info.rect.left
          const h = info.rect.bottom - info.rect.top
          if (w > 260 || h > 44) continue
          const isHeading = u !== header && u.matches(headingSelector)
          if (!isHeading && !info.hasGraphic) continue
          const prev = units.get(info.text)
          if (!prev || (prev.el === header && u !== header)) units.set(info.text, { el: u, rect: info.rect })
        }
        if (!units.size) return
        const reported = new Set()
        const candidates = [...parent.querySelectorAll('*')].filter((cand) =>
          !header.contains(cand) && elementSet.has(cand) && !cand.closest(interactiveControlSelector),
        )
        for (const cand of candidates) {
          const isHeading = cand.matches(headingSelector)
          const info = nonInteractiveSummary(cand)
          if (!info.rect || (!isHeading && !info.hasGraphic)) continue
          if (reported.has(info.text) || !units.has(info.text)) continue
          const box = visibleRect(cand)
          if (!box || box.height > 44) continue
          const w = info.rect.right - info.rect.left
          const h = info.rect.bottom - info.rect.top
          if (w > 280 || h > 44) continue
          const dy = info.rect.top - hRect.bottom
          const hUnit = units.get(info.text)
          if (dy < -2 || dy > 96 || Math.abs(info.rect.left - hUnit.rect.left) > 64) continue
          reported.add(`${headerIndex}:${info.text}`)
          reported.add(info.text)
          report('duplicate-nearby-header', [hUnit.el, cand])
        }
      })
    }

    function duplicateActionBar() {
      const menuScope = '[role="menu"], [role="listbox"], [role="tree"], [role="grid"], table'
      const buttonSignature = (btn) => {
        const aria = norm(btn.getAttribute('aria-label') || '')
        const txt = norm(btn.textContent || '')
        const title = norm(btn.getAttribute('title') || '')
        const names = [...new Set([aria, txt, title].filter((v) => v.length >= 1))]
        const svg = btn.querySelector('svg')
        const iconSig = svg
          ? [...svg.querySelectorAll('path, rect, circle, line, polyline, polygon')]
            .map((shape) => `${shape.tagName.toLowerCase()}:${['d', 'x', 'y', 'width', 'height', 'rx', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2', 'points'].map((k) => shape.getAttribute(k) || '').filter(Boolean).join(',')}`)
            .join('|')
            .replace(/\s+/g, ' ')
          : ''
        return { el: btn, names, iconSig }
      }
      const buttonsMatch = (a, b) =>
        a.names.some((name) => b.names.includes(name)) || (a.iconSig.length >= 10 && a.iconSig === b.iconSig)

      const rawBars = []
      for (const el of elements) {
        if (el.closest(menuScope)) continue
        const r = visibleRect(el)
        if (!r || (r.bottom - r.top > 180 && r.right - r.left > 120)) continue
        const children = [...el.children].filter((child) => {
          if (!elementSet.has(child)) return false
          if (child.matches('input[type="file"]')) return false
          if (child.getAttribute('role') === 'separator') return false
          const cr = visibleRect(child)
          return Boolean(cr && cr.right - cr.left > 2 && cr.bottom - cr.top > 2)
        })
        if (children.length < 4 || children.length > 16) continue
        const buttons = []
        for (const slot of children) {
          if (slot.matches('button, [role="button"]')) {
            buttons.push(slot)
            continue
          }
          const cr = visibleRect(slot)
          if (!cr || cr.right - cr.left > 120 || cr.bottom - cr.top > 120) continue
          if (slot.querySelector('input:not([type="hidden"]), textarea, select, [contenteditable="true"]')) continue
          const inner = [...slot.querySelectorAll('button, [role="button"]')].filter((b) => elementSet.has(b))
          if (inner.length === 1) buttons.push(inner[0])
        }
        if (buttons.length < 4 || buttons.length > 16 || buttons.length / children.length < 0.8) continue
        rawBars.push({ el, buttons: buttons.map(buttonSignature) })
      }

      const bars = rawBars.filter((bar, idx) => !rawBars.some((other, otherIdx) =>
        idx !== otherIdx
        && bar.el.contains(other.el)
        && bar.buttons.length === other.buttons.length
        && bar.buttons.every((b, i) => b.el === other.buttons[i].el),
      ))

      const lcaBranches = (a, b) => {
        const ancestors = new Set()
        for (let cur = a; cur; cur = cur.parentElement) ancestors.add(cur)
        let lca = b
        while (lca && !ancestors.has(lca)) lca = lca.parentElement
        if (!lca) return null
        let branchA = a
        while (branchA.parentElement && branchA.parentElement !== lca) branchA = branchA.parentElement
        let branchB = b
        while (branchB.parentElement && branchB.parentElement !== lca) branchB = branchB.parentElement
        return { lca, branchA, branchB }
      }
      const hasOwnItemBody = (branch, barEl) => {
        if (branch === barEl) return false
        for (const item of paintedNodes) {
          if (branch.contains(item.el) && !barEl.contains(item.el) && norm(item.text).length >= 2) return true
        }
        return [...branch.querySelectorAll('img, video, canvas, input:not([type="hidden"]), textarea, [contenteditable="true"]')]
          .some((media) => elementSet.has(media) && !barEl.contains(media))
      }

      for (let i = 0; i < bars.length; i++) {
        for (let j = i + 1; j < bars.length; j++) {
          const barA = bars[i]
          const barB = bars[j]
          if (barA.el.contains(barB.el) || barB.el.contains(barA.el)) continue
          const minLen = Math.min(barA.buttons.length, barB.buttons.length)
          const maxLen = Math.max(barA.buttons.length, barB.buttons.length)
          if (minLen / maxLen < 0.75) continue
          const usedB = new Set()
          let matched = 0
          for (const btnA of barA.buttons) {
            const idxB = barB.buttons.findIndex((btnB, k) => !usedB.has(k) && buttonsMatch(btnA, btnB))
            if (idxB >= 0) {
              usedB.add(idxB)
              matched++
            }
          }
          if (matched < Math.max(4, Math.ceil(maxLen * 0.8))) continue
          const itemSelector = 'tr, li, article, [role="row"], [role="listitem"]'
          if (barA.el.closest(itemSelector) !== barB.el.closest(itemSelector)) continue
          const rel = lcaBranches(barA.el, barB.el)
          if (rel && rel.branchA !== barA.el && rel.branchB !== barB.el
            && rel.branchA.tagName === rel.branchB.tagName
            && hasOwnItemBody(rel.branchA, barA.el)
            && hasOwnItemBody(rel.branchB, barB.el)) continue
          report('duplicate-action-bar', [barA.el, barB.el])
        }
      }
    }

    function duplicatePersonaStage() {
      const liveStages = elements.filter((el) => el.matches('[data-persona-stage="live"]'))
      if (liveStages.length >= 2) report('duplicate-persona-stage', liveStages)
    }

    if (config.duplicateNearbyHeader) duplicateNearbyHeader()
    if (config.duplicateActionBar) duplicateActionBar()
    if (config.duplicatePersonaStage) duplicatePersonaStage()
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
