import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileAtomicSync } from './lib/atomicFile.mjs'
import { shared } from './marketing/content.mjs'
import { loadSiteData } from './marketing/library/data.mjs'
import { formatPageDates, loadPageDates, PAGE_DATES_FILE } from './marketing/page-dates.mjs'
import { computeSitemapEntries } from './marketing/pages.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'marketing/sitemap.xml')
const robotsOutput = path.join(root, 'marketing/robots.txt')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

export const ALLOWED_CRAWLER_AGENTS = Object.freeze([
  'Googlebot',
  'Bingbot',
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'PerplexityBot',
  'ClaudeBot',
  'Google-Extended',
])

export function renderRobotsTxt(siteUrl) {
  const baseUrl = String(siteUrl).replace(/\/$/, '')
  const blocks = [
    ...ALLOWED_CRAWLER_AGENTS.map((agent) => `User-agent: ${agent}\nAllow: /`),
    'User-agent: *\nAllow: /',
  ]
  return `${blocks.join('\n\n')}\n\nSitemap: ${baseUrl}/sitemap.xml\n`
}

const escapeXml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;')

/**
 * 纯 XML 模板：给定一份已经算好的 entries（见 computeSitemapEntries），跟 siteData/日期无关，方便单测。
 * 每条带 `alternates`（hreflang）时，按 sitemap 的 xhtml 扩展写出中英互指——跟页面 <head> 里的 hreflang 是同一份数据。
 */
export function renderSitemap(siteUrl, entries) {
  const baseUrl = String(siteUrl).replace(/\/$/, '')
  const urls = entries.map((page) => {
    const alternates = (page.alternates ?? [])
      .map(({ lang, path: alternatePath }) => `\n    <xhtml:link rel="alternate" hreflang="${escapeXml(lang)}" href="${escapeXml(`${baseUrl}${alternatePath}`)}" />`)
      .join('')
    return `  <url>
    <loc>${escapeXml(`${baseUrl}${page.path}`)}</loc>
    <lastmod>${escapeXml(page.updatedAt)}</lastmod>
    <changefreq>${escapeXml(page.changefreq)}</changefreq>
    <priority>${escapeXml(page.priority)}</priority>${alternates}
  </url>`
  }).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
`
}

function parseArg(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] || fallback : fallback
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const checkOnly = process.argv.includes('--check')
  const today = parseArg('--now', new Date().toISOString()).slice(0, 10)
  const siteData = loadSiteData()
  const runtimeFacts = Object.freeze({ ...shared, version: packageJson.version })
  const previousDates = loadPageDates()
  const { dates, entries } = computeSitemapEntries({ siteData, runtimeFacts, previousDates, today })
  const sitemapXml = renderSitemap(shared.siteUrl, entries)
  const robotsTxt = renderRobotsTxt(shared.siteUrl)
  const datesJson = formatPageDates(dates)

  if (checkOnly) {
    const stale = []
    if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== sitemapXml) stale.push(path.relative(root, output))
    if (!fs.existsSync(robotsOutput) || fs.readFileSync(robotsOutput, 'utf8') !== robotsTxt) stale.push(path.relative(root, robotsOutput))
    if (!fs.existsSync(PAGE_DATES_FILE) || fs.readFileSync(PAGE_DATES_FILE, 'utf8') !== datesJson) stale.push(path.relative(root, PAGE_DATES_FILE))
    if (stale.length) {
      console.error(`Marketing sitemap/robots is stale:\n${stale.map((item) => `- ${item}`).join('\n')}`)
      process.exitCode = 1
    } else {
      console.log('MARKETING SITEMAP CHECK PASS')
    }
  } else {
    writeFileAtomicSync(output, sitemapXml, { fsync: false })
    writeFileAtomicSync(robotsOutput, robotsTxt, { fsync: false })
    fs.mkdirSync(path.dirname(PAGE_DATES_FILE), { recursive: true })
    fs.writeFileSync(PAGE_DATES_FILE, datesJson)
    console.log(`Generated ${path.relative(root, output)} (${entries.length} URLs), ${path.relative(root, robotsOutput)}, and ${path.relative(root, PAGE_DATES_FILE)}`)
  }
}
