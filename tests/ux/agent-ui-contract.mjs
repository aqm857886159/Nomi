import fs from 'node:fs'
import path from 'node:path'

export const AGENT_UI_VIEWPORT = Object.freeze({ width: 1440, height: 900, deviceScaleFactor: 1 })
export const DESIGN_SOURCES = Object.freeze({
  final: 'docs/design/mockups/2026-09-01-agent-ui-final-redesign.html',
  finalWalkthrough: 'docs/design/2026-09-02-agent-ui-v3-walkthrough.md',
  p0: 'docs/design/mockups/2026-09-03-agent-ui-p0-exception-states.html',
  p0Walkthrough: 'docs/design/2026-09-03-agent-ui-p0-exception-states-walkthrough.md',
})

const NUMERIC_PROPERTIES = new Set([
  'x', 'y', 'w', 'h', 'right', 'bottom', 'borderWidth', 'borderRadius', 'fontSize',
  'lineHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'gap',
])

function numberFromCss(value) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

function deltaFor(expected, actual) {
  if (typeof expected === 'number' && typeof actual === 'number') return actual - expected
  return null
}

function within(expected, actual, tolerance) {
  if (typeof expected === 'number' && typeof actual === 'number') {
    return Math.abs(actual - expected) <= (typeof tolerance === 'number' ? tolerance : 0)
  }
  return expected === actual
}

export function readGeneratedSpec(root) {
  const specPath = path.join(root, 'docs/design/agent-ui-spec.generated.json')
  return JSON.parse(fs.readFileSync(specPath, 'utf8'))
}

export async function readRuntimeObservation(page, selector) {
  const runtimeSelector = selector === '[data-agent-at-token[data-stale=true]]'
    ? '[data-agent-at-token][data-stale="true"]'
    : selector
  return page.evaluate((query) => {
    const cssNumber = (value) => {
      const parsed = Number.parseFloat(value)
      return Number.isFinite(parsed) ? parsed : null
    }
    const element = document.querySelector(query)
    if (!element) return { selector: query, exists: false, visible: false }
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0'
    const attributes = {}
    for (const attribute of element.attributes) attributes[attribute.name] = attribute.value
    return {
      selector: query,
      exists: true,
      visible,
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height, right: rect.right, bottom: rect.bottom },
      computed: {
        backgroundColor: style.backgroundColor,
        color: style.color,
        borderColor: style.borderColor,
        borderWidth: cssNumber(style.borderWidth),
        borderRadius: cssNumber(style.borderRadius),
        fontSize: cssNumber(style.fontSize),
        fontWeight: style.fontWeight,
        lineHeight: cssNumber(style.lineHeight),
        paddingTop: cssNumber(style.paddingTop),
        paddingRight: cssNumber(style.paddingRight),
        paddingBottom: cssNumber(style.paddingBottom),
        paddingLeft: cssNumber(style.paddingLeft),
        gap: cssNumber(style.gap),
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
      },
      order: element.parentElement ? Array.from(element.parentElement.children).indexOf(element) : null,
      tagName: element.tagName.toLowerCase(),
      role: element.getAttribute('role'),
      ariaLabel: element.getAttribute('aria-label'),
      text: (element.innerText || '').trim().slice(0, 240),
      attributes,
    }
  }, runtimeSelector)
}

function mismatch(rule, property, expected, actual, tolerance, message) {
  return {
    ruleId: rule.id ?? rule.anchor ?? rule.name,
    sourceLocator: rule.sourceLocator,
    selector: rule.selector,
    state: rule.state,
    severity: rule.severity,
    sourceLibrary: rule.sourceLibrary,
    adaptationRule: rule.adaptationRule,
    property,
    expected,
    actual,
    delta: deltaFor(expected, actual),
    tolerance,
    message,
  }
}

export function compareRuntimeRule(rule, observation) {
  if (rule.blocked) return { observation, failures: [], status: 'blocked' }
  const failures = []
  const expected = rule.expected ?? {}
  if (!observation.exists) {
    if (rule.stateNotReached) return { observation, failures: [], status: 'state-not-reached' }
    return { observation, failures: [mismatch(rule, 'exists', true, false, 0, 'required runtime anchor is missing')], status: 'mismatch' }
  }
  if (expected.visible !== undefined && expected.visible !== observation.visible) {
    failures.push(mismatch(rule, 'visible', expected.visible, observation.visible, 0, 'visibility differs'))
  }
  for (const [property, expectedValue] of Object.entries(expected)) {
    if (property === 'visible' || property === 'textIncludes' || property === 'attribute') continue
    if (expectedValue === undefined) continue
    const actual = property in observation.rect ? observation.rect[property] : observation.computed[property]
    const tolerance = rule.tolerance?.[property] ?? rule.tolerance?.default ?? 0
    if (!within(expectedValue, actual, tolerance)) failures.push(mismatch(rule, property, expectedValue, actual, tolerance, 'computed runtime value is outside tolerance'))
  }
  if (expected.textIncludes && !observation.text.includes(expected.textIncludes)) {
    failures.push(mismatch(rule, 'text', expected.textIncludes, observation.text, 'contains', 'user-facing copy drifted'))
  }
  if (expected.attribute) {
    for (const [name, value] of Object.entries(expected.attribute)) {
      const actual = observation.attributes[name] ?? null
      if (actual !== value) failures.push(mismatch(rule, `attribute:${name}`, value, actual, 0, 'runtime hook or state attribute differs'))
    }
  }
  return { observation, failures, status: failures.length ? 'mismatch' : 'pass' }
}

export async function measureRuntimeContract(page, { spec, state = 'normal', rules = [] } = {}) {
  const generatedRules = (spec?.elements ?? []).filter((element) => element.selector).map((element) => ({
    id: element.anchor,
    selector: element.selector,
    sourceLocator: element.sourceLocator,
    state: element.state ?? state,
    severity: element.severity ?? 'P1',
    tolerance: element.tolerance ?? element.tolerances ?? {},
    expected: {
      w: element.geometry?.w,
      h: element.geometry?.h,
      backgroundColor: element.tokens?.backgroundColor,
      color: element.tokens?.color,
      borderColor: element.tokens?.borderColor,
      borderWidth: numberFromCss(element.tokens?.borderWidth),
      borderRadius: numberFromCss(element.tokens?.borderRadius),
      fontSize: numberFromCss(element.tokens?.fontSize),
      fontWeight: element.tokens?.fontWeight,
      lineHeight: numberFromCss(element.tokens?.lineHeight),
      paddingTop: numberFromCss(element.tokens?.paddingTop),
      paddingRight: numberFromCss(element.tokens?.paddingRight),
      paddingBottom: numberFromCss(element.tokens?.paddingBottom),
      paddingLeft: numberFromCss(element.tokens?.paddingLeft),
      gap: numberFromCss(element.tokens?.gap),
    },
  }))
  const allRules = [...generatedRules, ...rules]
  const results = []
  for (const rule of allRules) {
    const observation = await readRuntimeObservation(page, rule.selector)
    const compared = compareRuntimeRule(rule, observation)
    results.push({ rule, ...compared })
  }
  const mismatches = results.flatMap((result) => result.failures)
  return {
    schemaVersion: 1,
    target: 'electron-runtime',
    viewport: AGENT_UI_VIEWPORT,
    state,
    sourceContracts: DESIGN_SOURCES,
    summary: {
      rules: allRules.length,
      pass: results.filter((result) => result.status === 'pass').length,
      mismatch: results.filter((result) => result.status === 'mismatch').length,
      stateNotReached: results.filter((result) => result.status === 'state-not-reached').length,
      blocked: allRules.filter((rule) => rule.blocked).length,
    },
    mismatches,
    stateNotReached: results.filter((result) => result.status === 'state-not-reached').map((result) => ({
      ruleId: result.rule.id,
      sourceLocator: result.rule.sourceLocator,
      selector: result.rule.selector,
      state: result.rule.state,
      severity: result.rule.severity,
    })),
    observations: results.map(({ rule, observation, status }) => ({ ruleId: rule.id, selector: rule.selector, state: rule.state, status, observation })),
  }
}

export function writeMismatchReport(filePath, report) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}
