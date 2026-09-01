import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { marketingPages } from '../marketing/site-manifest.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DEFAULT_BASE_URL = 'https://nomiaqm.com'
const REPORT_TIME_ZONE = 'Asia/Shanghai'

const dateInTimeZone = (value) => new Intl.DateTimeFormat('en-CA', {
  timeZone: REPORT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date(value))

const parseAttributes = (tag) => Object.fromEntries(
  [...tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map((match) => [match[1].toLowerCase(), match[2]]),
)

const getTag = (html, tag, required = {}) => {
  const candidates = [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'gi'))].map((match) => match[0])
  return candidates.find((candidate) => {
    const attributes = parseAttributes(candidate)
    return Object.entries(required).every(([key, value]) => attributes[key.toLowerCase()]?.toLowerCase() === String(value).toLowerCase())
  }) || ''
}

const getTagAttribute = (tag, attribute) => parseAttributes(tag)[attribute.toLowerCase()] || ''
const getMeta = (html, attribute, value) => getTag(html, 'meta', { [attribute]: value })
const hasMeta = (html, attribute, value) => Boolean(getMeta(html, attribute, value))
const getLink = (html, rel) => getTag(html, 'link', { rel })
const hasText = (html, pattern) => pattern.test(html)

const failure = (rule, message, evidence, recommendation, severity = 'error') => ({
  rule,
  severity,
  message,
  evidence,
  recommendation,
})

export function auditHtml(html, url, options = {}) {
  const failures = []
  const description = getTagAttribute(getMeta(html, 'name', 'description'), 'content')
  const jsonLdNodes = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .flatMap((match) => {
      try {
        const parsed = JSON.parse(match[1])
        return Array.isArray(parsed?.['@graph']) ? parsed['@graph'] : [parsed]
      } catch {
        return []
      }
    })
  const schemaType = (node, type) => Array.isArray(node?.['@type']) ? node['@type'].includes(type) : node?.['@type'] === type
  const expectedApplicationId = `${new URL(url).origin}/#application`
  const checks = [
    ['META-TITLE', hasText(html, /<title>[^<]+\S<\/title>/i), 'title', 'Add a unique, descriptive title.'],
    ['META-DESCRIPTION', description.length >= 50 && description.length <= 160, 'description', 'Add a page-specific 50–160 character meta description.'],
    ['META-CANONICAL', getTagAttribute(getLink(html, 'canonical'), 'href') === url, 'canonical', 'Point canonical to the exact public URL, including locale and trailing slash.'],
    ['META-OG', ['og:title', 'og:description', 'og:image', 'og:image:alt'].every((key) => hasMeta(html, 'property', key)), 'Open Graph title/description/image/alt', 'Add a complete Open Graph card so shared links have the right preview.'],
    ['META-TWITTER', ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image'].every((key) => hasMeta(html, 'name', key)), 'Twitter card fields', 'Add Twitter card fields matching the Open Graph identity.'],
    ['SCHEMA-WEBPAGE', jsonLdNodes.some((node) => schemaType(node, 'WebPage')), 'JSON-LD WebPage', 'Add valid JSON-LD containing a factual WebPage node.'],
    ['SCHEMA-APPLICATION', jsonLdNodes.some((node) => schemaType(node, 'SoftwareApplication') && node['@id'] === expectedApplicationId), 'JSON-LD SoftwareApplication', 'Link the page to the shared Nomi SoftwareApplication identity.'],
    ['MEDIA-ALT', [...html.matchAll(/<img\b[^>]*>/gi)].every((match) => /\balt=["'][^"']*["']/i.test(match[0])), 'image alt attributes', 'Give every meaningful image a concise alt attribute; use empty alt only for decorative images.'],
    ['META-ROBOTS', hasMeta(html, 'name', 'robots'), 'robots directive', 'Declare index/follow behavior explicitly on indexed pages.'],
    ['META-LANG', /<html\b[^>]*\blang=["'][^"']+["']/i.test(html), 'html lang', 'Declare the document language so crawlers and assistive technology can interpret it.'],
  ]

  for (const [rule, ok, evidence, recommendation] of checks) {
    if (!ok) failures.push(failure(rule, `${rule} check failed for ${url}`, evidence, recommendation))
  }

  const requiredAlternate = options.requiredAlternate
  if (requiredAlternate && !getLink(html, 'alternate')) {
    failures.push(failure('META-HREFLANG', 'Expected a reciprocal hreflang link', 'alternate link', 'Add reciprocal hreflang links for every localized page.'))
  }

  return { url, checked: checks.length, failures }
}

const extractSitemapEntries = (xml) => [...xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>[\s\S]*?<\/url>/gi)]
  .map((match) => ({ url: match[1].trim(), lastmod: match[2].trim() }))

export function auditSitemap(xml, manifest = marketingPages, baseUrl = DEFAULT_BASE_URL) {
  const failures = []
  const entries = extractSitemapEntries(xml)
  const entryByUrl = new Map(entries.map((entry) => [entry.url, entry]))
  for (const page of manifest) {
    const url = `${baseUrl.replace(/\/$/, '')}${page.path}`
    const entry = entryByUrl.get(url)
    if (!entry) {
      failures.push(failure('SITEMAP-MISSING-URL', `Sitemap is missing ${url}`, url, 'Add the public route to the generated sitemap.'))
    } else if (entry.lastmod < page.updatedAt) {
      failures.push(failure('SITEMAP-STALE', `Sitemap lastmod is older than the page manifest for ${url}`, `${entry.lastmod} < ${page.updatedAt}`, 'Regenerate marketing/sitemap.xml after a public page change.'))
    }
  }
  for (const entry of entries) {
    if (!entry.url.startsWith(`${baseUrl.replace(/\/$/, '')}/`)) {
      failures.push(failure('SITEMAP-EXTERNAL-URL', `Sitemap contains an off-site URL: ${entry.url}`, entry.url, 'Keep sitemap entries on the canonical Nomi origin.'))
    }
  }
  return { checked: manifest.length, entries, failures }
}

export function auditRobots(text, baseUrl = DEFAULT_BASE_URL) {
  const failures = []
  const normalized = text.replaceAll('\r', '')
  if (/^Disallow:\s*\/\s*$/im.test(normalized) && !/^Allow:\s*\/\s*$/im.test(normalized)) {
    failures.push(failure('ROBOTS-DISALLOW-ALL', 'robots.txt blocks the entire site', 'Disallow: /', 'Allow public marketing pages to be crawled.'))
  }
  const sitemapUrl = `${baseUrl.replace(/\/$/, '')}/sitemap.xml`
  const escapedUrl = sitemapUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (!new RegExp(`^Sitemap:\\s*${escapedUrl}\\s*$`, 'im').test(normalized)) {
    failures.push(failure('ROBOTS-SITEMAP', 'robots.txt does not point to the canonical sitemap', sitemapUrl, 'Add a Sitemap directive with the public sitemap URL.'))
  }
  return { checked: 2, failures }
}

const header = (response, name) => response.headers?.get?.(name) || response.headers?.get?.(name.toLowerCase()) || response.headers?.[name] || ''

const FETCH_TIMEOUT_MS = 15_000
const safeUrl = (value) => {
  try {
    const parsed = new URL(String(value))
    parsed.searchParams.delete('key')
    return parsed.toString()
  } catch {
    return '[unparseable URL]'
  }
}
const redactSensitiveText = (value) => String(value).replace(/([?&](?:key|token|api[_-]?key)=)[^&\s]+/gi, '$1[redacted]')

async function fetchResponse(fetchImpl, url, init = {}, readBody) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${safeUrl(url)}`)
    return { response, body: readBody ? await readBody(response) : undefined }
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`Request timed out after ${FETCH_TIMEOUT_MS}ms for ${safeUrl(url)}`)
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchText(fetchImpl, url) {
  const { response, body } = await fetchResponse(fetchImpl, url, { headers: { accept: 'text/html,application/xml;q=0.9,*/*;q=0.8', 'user-agent': 'Nomi-SEO-Observatory/1.0' } }, (result) => result.text())
  return { body, contentType: header(response, 'content-type') }
}

async function measurePageSpeed(fetchImpl, url, key) {
  if (!key) return { status: 'not_configured' }
  const endpoint = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed')
  endpoint.searchParams.set('url', url)
  endpoint.searchParams.set('strategy', 'mobile')
  endpoint.searchParams.set('category', 'performance')
  endpoint.searchParams.set('key', key)
  const { body: data } = await fetchResponse(fetchImpl, endpoint, { headers: { accept: 'application/json', 'user-agent': 'Nomi-SEO-Observatory/1.0' } }, (result) => result.json())
  return {
    status: 'ok',
    strategy: 'mobile',
    performanceScore: data.lighthouseResult?.categories?.performance?.score ?? null,
    metrics: {
      lcp: data.lighthouseResult?.audits?.['largest-contentful-paint']?.numericValue ?? null,
      cls: data.lighthouseResult?.audits?.['cumulative-layout-shift']?.numericValue ?? null,
      inp: data.lighthouseResult?.audits?.['interaction-to-next-paint']?.numericValue ?? null,
    },
  }
}

export async function runAudit({
  baseUrl = DEFAULT_BASE_URL,
  paths = marketingPages.map((page) => page.path),
  manifest = marketingPages,
  fetchImpl = globalThis.fetch,
  now = new Date().toISOString(),
  pageSpeedApiKey = process.env.PAGESPEED_API_KEY,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required')
  const origin = baseUrl.replace(/\/$/, '')
  const pages = []
  const networkFailures = []
  for (const pagePath of paths) {
    const url = `${origin}${pagePath}`
    try {
      const { body } = await fetchText(fetchImpl, url)
      pages.push(auditHtml(body, url, { requiredAlternate: pagePath === '/' || pagePath === '/en/' }))
    } catch (error) {
      networkFailures.push(failure('NETWORK-PAGE', `Could not fetch ${url}`, error.message, 'Retry the scheduled audit and investigate origin availability.', 'error'))
    }
  }

  let sitemap = { checked: manifest.length, entries: [], failures: [] }
  try {
    const { body } = await fetchText(fetchImpl, `${origin}/sitemap.xml`)
    sitemap = auditSitemap(body, manifest, origin)
  } catch (error) {
    networkFailures.push(failure('NETWORK-SITEMAP', 'Could not fetch sitemap.xml', error.message, 'Keep robots.txt and sitemap.xml publicly reachable.', 'error'))
  }

  let robots = { checked: 2, failures: [] }
  try {
    const { body } = await fetchText(fetchImpl, `${origin}/robots.txt`)
    robots = auditRobots(body, origin)
  } catch (error) {
    networkFailures.push(failure('NETWORK-ROBOTS', 'Could not fetch robots.txt', error.message, 'Keep robots.txt publicly reachable.', 'error'))
  }

  let performance
  try {
    performance = await measurePageSpeed(fetchImpl, `${origin}/`, pageSpeedApiKey)
  } catch (error) {
    performance = { status: 'error', error: redactSensitiveText(error.message) }
  }

  const performanceFailures = performance.status === 'error'
    ? [failure('PERF-API', 'PageSpeed measurement failed', performance.error, 'Retry the next scheduled run or verify the PageSpeed API key and quota.', 'warning')]
    : []
  const failures = [...networkFailures, ...pages.flatMap((page) => page.failures), ...sitemap.failures, ...robots.failures, ...performanceFailures]
  return {
    schemaVersion: 1,
    observedAt: now,
    baseUrl: origin,
    pages,
    sitemap,
    robots,
    performance,
    summary: {
      pages: pages.length,
      checks: pages.reduce((sum, page) => sum + page.checked, 0) + sitemap.checked + robots.checked,
      failures: failures.length,
      networkFailures: networkFailures.length,
      errors: failures.filter((item) => item.severity === 'error').length,
    },
    failures,
  }
}

export function renderMarkdown(report) {
  const lines = [
    `# Nomi SEO Observatory — ${dateInTimeZone(report.observedAt)}`,
    '',
    `- Origin: ${report.baseUrl}`,
    `- Pages checked: ${report.summary.pages}`,
    `- Checks: ${report.summary.checks}`,
    `- Findings: ${report.summary.failures}`,
    `- PageSpeed: ${report.performance.status}${report.performance.performanceScore == null ? '' : ` (${Math.round(report.performance.performanceScore * 100)}/100)`}`,
    '',
    '## Findings',
    '',
  ]
  if (!report.failures.length) lines.push('No actionable findings in this run.')
  else {
    lines.push('| Rule | Severity | Evidence | Recommendation |', '|---|---|---|---|')
    for (const item of report.failures) lines.push(`| ${item.rule} | ${item.severity} | ${item.evidence.replaceAll('|', '\\|')} | ${item.recommendation.replaceAll('|', '\\|')} |`)
  }
  lines.push('', '## Optimization loop', '', 'Compare this report with the previous two runs. Change one falsifiable SEO hypothesis at a time; deterministic low-risk fixes may be proposed as a PR, while content or repository-setting changes remain reviewable recommendations.', '')
  return lines.join('\n')
}

function parseArg(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] || fallback : fallback
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const baseUrl = parseArg('--base-url', DEFAULT_BASE_URL)
  const outDir = path.resolve(root, parseArg('--out-dir', 'docs/seo/data'))
  const reportsDir = path.resolve(root, parseArg('--reports-dir', 'docs/seo/reports'))
  const now = parseArg('--now', new Date().toISOString())
  const report = await runAudit({ baseUrl, now })
  fs.mkdirSync(outDir, { recursive: true })
  fs.mkdirSync(reportsDir, { recursive: true })
  const stamp = dateInTimeZone(now)
  fs.writeFileSync(path.join(outDir, `${stamp}.json`), `${JSON.stringify(report, null, 2)}\n`)
  fs.writeFileSync(path.join(reportsDir, `${stamp}.md`), renderMarkdown(report))
  console.log(`SEO audit saved ${path.relative(root, path.join(outDir, `${stamp}.json`))}`)
  console.log(`SEO findings: ${report.summary.failures}`)
  if (report.summary.networkFailures) process.exitCode = 1
}
