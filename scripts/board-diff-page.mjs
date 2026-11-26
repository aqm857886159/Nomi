// Serialized by Playwright. Both the design frame and the live window use this exact reader.
export function readSurface({ rootSelector, tokenCSS, theme }) {
  const roots = rootSelector ? document.querySelectorAll(rootSelector) : [document.body]
  if (roots.length !== 1) throw new Error('量取区域必须唯一：' + rootSelector)
  const root = roots[0]
  const origin = root.getBoundingClientRect()
  const all = [...document.body.querySelectorAll('*')]
  const ids = new Map(all.map((el, index) => [el, index]))
  const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  const rgba = value => {
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = value
    context.fillRect(0, 0, 1, 1)
    const bytes = context.getImageData(0, 0, 1, 1).data
    return bytes[3] === 0 ? 'transparent' : '#' + [...bytes].map(n => n.toString(16).padStart(2, '0')).join('')
  }
  // Resolve aliases and color-mix in an isolated shadow tree. Both palettes come from
  // the design system, independently of either surface's stylesheet/variable names.
  const host = document.createElement('div')
  host.dataset.mantineColorScheme = theme
  host.style.cssText = 'position:fixed;left:-10000px;pointer-events:none'
  const shadow = host.attachShadow({ mode: 'closed' })
  const css = document.createElement('style')
  css.textContent = tokenCSS.replaceAll(':root', ':host').replaceAll(':host[data-mantine-color-scheme="dark"]', ':host([data-mantine-color-scheme="dark"])')
  const probe = document.createElement('i')
  shadow.append(css, probe)
  document.body.appendChild(host)
  const palette = new Map()
  try {
    const names = new Set([...tokenCSS.matchAll(/(--nomi-[\w-]+)\s*:/g)].map(m => m[1]))
    // Prefer the base surface / ink when a specialized token shares its value.
    for (const name of ['--nomi-paper', '--nomi-ink', ...names]) {
      const value = getComputedStyle(host).getPropertyValue(name).trim()
      if (!value || !CSS.supports('color', value)) continue
      probe.style.color = 'var(' + name + ')'
      const key = rgba(getComputedStyle(probe).color)
      if (!palette.has(key)) palette.set(key, name.slice(7))
    }
  } finally { host.remove() }
  const colors = new Map()
  const color = cssColor => {
    if (!colors.has(cssColor)) {
      const key = rgba(cssColor)
      colors.set(cssColor, palette.get(key) ?? key)
    }
    return colors.get(cssColor)
  }
  const rounded = n => Math.round(n * 1000) / 1000
  const visible = el => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && el.getClientRects().length > 0
  const normalize = s => (s ?? '').replace(/\s+/g, ' ').trim()
  // Look through single-child wrappers for a visible flow sibling in the same row or column.
  function adjacentGap(el, before) {
    for (let branch = el; branch && branch !== root; branch = branch.parentElement) {
      const next = before ? 'previousElementSibling' : 'nextElementSibling'
      let sibling = branch[next]
      while (sibling && !visible(sibling)) sibling = sibling[next]
      if (!sibling) continue
      const a = (before ? sibling : branch).getBoundingClientRect()
      const b = (before ? branch : sibling).getBoundingClientRect()
      if (Math.min(a.right, b.right) > Math.max(a.left, b.left) && a.top <= b.top) return rounded(b.top - a.bottom)
      if (Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) && a.left <= b.left) return rounded(b.left - a.right)
    }
    return null
  }
  function edges(style) {
    const sides = ['Top', 'Right', 'Bottom', 'Left']
    const result = {}
    for (const side of sides) {
      const w = parseFloat(style['border' + side + 'Width'])
      const c = color(style['border' + side + 'Color'])
      result['border' + side + 'Width'] = c === 'transparent' ? 0 : w
      result['border' + side + 'Color'] = result['border' + side + 'Width'] ? c : null
    }
    const physical = { ...result }
    // CSSOM serializes shadows as color + lengths. Ignore blurred shadows; a zero-blur
    // inset with spread or offset paints a measurable edge (including one-sided dividers).
    for (const layer of style.boxShadow.split(/,(?![^()]*\))/)) {
      if (!/\binset\b/.test(layer)) continue
      const lengths = [...layer.matchAll(/(-?[\d.]+)px\b/g)].map(m => Number(m[1]))
      const [dx, dy, blur, spread = 0] = lengths
      if (blur !== 0) continue
      const c = color(layer.replace(/-?[\d.]+px\b|\binset\b/g, '').trim())
      if (c === 'transparent') continue
      for (const [i, extent] of [spread + dy, spread - dx, spread - dy, spread + dx].entries()) {
        if (extent <= 0) continue
        const side = sides[i]
        const old = result['border' + side + 'Width']
        if (!old || result['border' + side + 'Color'] === c) {
          result['border' + side + 'Width'] = Math.max(old, physical['border' + side + 'Width'] + extent)
          result['border' + side + 'Color'] = c
        }
      }
    }
    return result
  }
  const fontMetrics = new Map()
  const monospace = style => {
    const font = style.fontStyle + ' ' + style.fontWeight + ' 32px ' + style.fontFamily
    if (!fontMetrics.has(font)) {
      context.font = font
      fontMetrics.set(font, Math.abs(context.measureText('iiiiiiii').width - context.measureText('WWWWWWWW').width) < 0.01)
    }
    return fontMetrics.get(font)
  }
  const rows = []
  for (const el of [root, ...root.querySelectorAll('*')]) {
    if (el.ownerSVGElement || !visible(el)) continue
    const rect = el.getBoundingClientRect()
    if (!rect.width || !rect.height) continue
    const style = getComputedStyle(el)
    const parentStyle = getComputedStyle(el.parentElement ?? el)
    const tag = el.localName
    const own = normalize([...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' '))
    const label = el.getAttribute('aria-label') ?? ''
    const text = normalize(el.innerText ?? el.textContent)
    const values = {
      text, fontSize: parseFloat(style.fontSize), lineHeight: style.lineHeight === 'normal' ? 'normal' : parseFloat(style.lineHeight),
      fontWeight: Number(style.fontWeight), monospace: monospace(style),
      color: color(style.color), backgroundColor: color(style.backgroundColor), fontVariantNumeric: style.fontVariantNumeric,
      x: rounded(rect.x - origin.x), y: rounded(rect.y - origin.y), width: rounded(rect.width), height: rounded(rect.height),
      gapBefore: adjacentGap(el, true), gapAfter: adjacentGap(el, false), iconPath: null, ...edges(style),
    }
    if (tag === 'svg') {
      const path = [...el.querySelectorAll('path[d]')].find(p => {
        const s = getComputedStyle(p)
        return s.display !== 'none' && s.visibility === 'visible' && s.opacity !== '0' && (s.stroke !== 'none' || s.fill !== 'none')
      })
      values.iconPath = path?.getAttribute('d')?.trim() ?? null
    }
    for (const corner of ['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight']) {
      const radius = style['border' + corner + 'Radius']
      values['radius' + corner] = /^[.\d]+px$/.test(radius) ? parseFloat(radius) : radius
    }
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      values['padding' + side] = parseFloat(style['padding' + side])
      values['parentPadding' + side] = parseFloat(parentStyle['padding' + side])
    }
    rows.push({ index: ids.get(el) ?? -1, parent: ids.get(el.parentElement) ?? -1, tag, own, label,
      mark: el.getAttribute('data-board'), values })
  }
  return rows
}
