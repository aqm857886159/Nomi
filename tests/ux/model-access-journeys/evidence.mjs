import fs from 'node:fs'
import path from 'node:path'

const SECRET_KEY = /authorization|api[-_]?key|token|cookie|secret|password/i

export class JourneyFailure extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'JourneyFailure'
    this.code = code
    this.details = details
  }
}

export class JourneyBlocked extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'JourneyBlocked'
    this.code = code
    this.details = details
  }
}

export function redact(value, key = '') {
  if (SECRET_KEY.test(key)) return value ? '[REDACTED]' : value
  if (Array.isArray(value)) return value.map((item) => redact(item))
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return `[${value.constructor?.name || 'Object'}]`
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redact(item, name)]))
  }
  if (typeof value === 'string') {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
      .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, 'sk-[REDACTED]')
  }
  return value
}

export class EvidenceRecorder {
  constructor({ journey, outputRoot }) {
    this.journey = journey
    this.dir = path.join(outputRoot, journey.id)
    fs.mkdirSync(this.dir, { recursive: true })
    this.report = {
      schemaVersion: 1,
      journeyId: journey.id,
      title: journey.title,
      requirement: journey.requirement,
      status: 'RUNNING',
      startedAt: new Date().toISOString(),
      spans: [],
      screenshots: [],
      requests: [],
      artifacts: [],
      diagnostics: [],
    }
  }

  async step(phase, name, action) {
    const startedAt = Date.now()
    const span = { phase, name, status: 'RUNNING', startedAt: new Date(startedAt).toISOString() }
    this.report.spans.push(span)
    try {
      const evidence = await action()
      span.status = 'PASS'
      if (evidence !== undefined) span.evidence = redact(evidence)
      return evidence
    } catch (error) {
      span.status = error instanceof JourneyBlocked ? 'BLOCKED' : 'FAIL'
      span.error = redact({ code: error?.code || 'unexpected-error', message: error?.message || String(error), details: error?.details })
      throw error
    } finally {
      span.durationMs = Date.now() - startedAt
      this.flush()
    }
  }

  async screenshot(page, name) {
    const fileName = `${String(this.report.screenshots.length + 1).padStart(2, '0')}-${name}.png`
    const file = path.join(this.dir, fileName)
    await page.screenshot({ path: file, fullPage: true })
    this.report.screenshots.push(fileName)
    this.flush()
    return fileName
  }

  attachRequests(requests) {
    this.report.requests = redact(requests)
  }

  diagnostic(message) {
    this.report.diagnostics.push(redact(message))
  }

  artifact(kind, evidence) {
    this.report.artifacts.push({ kind, ...redact(evidence) })
  }

  finish(status, error) {
    this.report.status = status
    this.report.finishedAt = new Date().toISOString()
    this.report.durationMs = new Date(this.report.finishedAt).getTime() - new Date(this.report.startedAt).getTime()
    if (error) this.report.error = redact({ code: error.code || 'unexpected-error', message: error.message || String(error), details: error.details })
    this.flush()
    return this.report
  }

  flush() {
    fs.writeFileSync(path.join(this.dir, 'report.json'), `${JSON.stringify(this.report, null, 2)}\n`)
  }
}
