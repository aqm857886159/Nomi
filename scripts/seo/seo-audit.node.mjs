import assert from 'node:assert/strict'
import test from 'node:test'
import { auditHtml, auditRobots, auditSitemap, runAudit } from './seo-audit.mjs'

const pageHtml = (url = 'https://nomiaqm.com/') => `<!doctype html><html lang="zh-CN"><head>
<title>Nomi</title><meta name="description" content="A useful description for the Nomi local-first AI video workbench that helps creators finish a real editable first cut.">
<meta name="robots" content="index,follow">
<link rel="canonical" href="${url}"><link rel="alternate" hreflang="zh-CN" href="https://nomiaqm.com/">
<meta property="og:title" content="Nomi"><meta property="og:description" content="A useful description.">
<meta property="og:image" content="https://nomiaqm.com/assets/card.jpg"><meta property="og:image:alt" content="Nomi card">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="Nomi"><meta name="twitter:description" content="A useful description."><meta name="twitter:image" content="https://nomiaqm.com/assets/card.jpg">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage","url":"${url}"},{"@type":"SoftwareApplication","@id":"https://nomiaqm.com/#application","name":"Nomi"}]}</script>
</head><body><img src="/assets/hero.jpg" alt="Nomi workbench"></body></html>`

const response = (body, status = 200, headers = { 'content-type': 'text/html' }) => ({
  ok: status >= 200 && status < 400,
  status,
  headers: new Map(Object.entries(headers)),
  async text() { return body },
  async json() { return JSON.parse(body) },
})

test('auditHtml passes a complete page contract', () => {
  const result = auditHtml(pageHtml(), 'https://nomiaqm.com/')
  assert.equal(result.failures.length, 0)
  assert.equal(result.checked, 10)
})

test('auditHtml reports actionable missing metadata and image alt', () => {
  const result = auditHtml('<html><head><title>x</title></head><body><img src="/hero.jpg"></body></html>', 'https://nomiaqm.com/x')
  assert.ok(result.failures.some((item) => item.rule === 'META-DESCRIPTION'))
  assert.ok(result.failures.some((item) => item.rule === 'META-CANONICAL'))
  assert.ok(result.failures.some((item) => item.rule === 'META-OG'))
  assert.ok(result.failures.some((item) => item.rule === 'META-TWITTER'))
  assert.ok(result.failures.some((item) => item.rule === 'SCHEMA-WEBPAGE'))
  assert.ok(result.failures.some((item) => item.rule === 'MEDIA-ALT'))
})

test('auditHtml rejects descriptions longer than the recommended range', () => {
  const html = pageHtml().replace('A useful description for the Nomi local-first AI video workbench that helps creators finish a real editable first cut.', 'x'.repeat(161))
  const result = auditHtml(html, 'https://nomiaqm.com/')
  assert.ok(result.failures.some((item) => item.rule === 'META-DESCRIPTION'))
})

test('auditSitemap catches a stale or missing canonical route', () => {
  const xml = `<urlset><url><loc>https://nomiaqm.com/</loc><lastmod>2026-08-01</lastmod></url></urlset>`
  const result = auditSitemap(xml, [{ path: '/', updatedAt: '2026-08-23' }, { path: '/en/', updatedAt: '2026-08-23' }], 'https://nomiaqm.com')
  assert.ok(result.failures.some((item) => item.rule === 'SITEMAP-MISSING-URL'))
  assert.ok(result.failures.some((item) => item.rule === 'SITEMAP-STALE'))
})

test('auditRobots requires crawl access, AI search crawler access, and a sitemap pointer', () => {
  assert.equal(auditRobots('User-agent: *\nAllow: /\nSitemap: https://nomiaqm.com/sitemap.xml\n').failures.length, 0)
  const result = auditRobots('User-agent: *\nDisallow: /\n')
  assert.ok(result.failures.some((item) => item.rule === 'ROBOTS-DISALLOW-ALL'))
  assert.ok(result.failures.some((item) => item.rule === 'ROBOTS-SITEMAP'))
  const blockedAi = auditRobots('User-agent: OAI-SearchBot\nDisallow: /\n\nUser-agent: *\nAllow: /\nSitemap: https://nomiaqm.com/sitemap.xml\n')
  assert.ok(blockedAi.failures.some((item) => item.rule === 'ROBOTS-CRAWLER-DISALLOW'))
})

test('runAudit records network failures and optional performance status', async () => {
  const result = await runAudit({
    baseUrl: 'https://nomiaqm.com',
    paths: ['/'],
    manifest: [{ path: '/', updatedAt: '2026-08-23' }],
    now: '2026-08-23T00:00:00.000Z',
    fetchImpl: async (url) => url.endsWith('/sitemap.xml')
      ? response('<urlset><url><loc>https://nomiaqm.com/</loc><lastmod>2026-08-23</lastmod></url></urlset>', 200, { 'content-type': 'application/xml' })
      : url.endsWith('/robots.txt')
        ? response('User-agent: *\nAllow: /\nSitemap: https://nomiaqm.com/sitemap.xml\n', 200, { 'content-type': 'text/plain' })
      : response(pageHtml(), 200),
  })
  assert.equal(result.pages.length, 1)
  assert.equal(result.performance.status, 'not_configured')
  assert.equal(result.summary.failures, 0)
})

test('runAudit surfaces a configured PageSpeed API failure', async () => {
  const result = await runAudit({
    baseUrl: 'https://nomiaqm.com',
    paths: [],
    manifest: [],
    pageSpeedApiKey: 'configured-for-test',
    fetchImpl: async (url) => url.toString().includes('googleapis.com')
      ? response('', 503, { 'content-type': 'application/json' })
      : response('', 404),
  })
  assert.equal(result.performance.status, 'error')
  assert.ok(result.failures.some((item) => item.rule === 'PERF-API'))
})

test('runAudit never writes a PageSpeed API key into an error report', async () => {
  const secret = 'SECRET-XYZ'
  const result = await runAudit({
    baseUrl: 'https://nomiaqm.com',
    paths: [],
    manifest: [],
    pageSpeedApiKey: secret,
    fetchImpl: async (url) => {
      if (url.toString().includes('googleapis.com')) {
        const error = new Error('aborted')
        error.name = 'AbortError'
        throw error
      }
      return response('', 404)
    },
  })
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret))
})
