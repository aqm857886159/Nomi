import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { shared } from '../../scripts/marketing/content.mjs'
import { loadSiteData } from '../../scripts/marketing/library/data.mjs'
import { loadPageDates } from '../../scripts/marketing/page-dates.mjs'
import { computeSitemapEntries } from '../../scripts/marketing/pages.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const version = JSON.parse(read('package.json')).version
const runtimeFacts = Object.freeze({ ...shared, version })
const canonicalCommunityUrl = shared.discussionUrl

// 手册页 2026-09-28 退役（301 到 /quickstart，见 marketing/_redirects），这份合同只再看还在的核心上手页。
const pages = [
  ['marketing/index.html', 'https://nomiaqm.com/'],
  ['marketing/en/index.html', 'https://nomiaqm.com/en/'],
  ['marketing/quickstart.html', 'https://nomiaqm.com/quickstart'],
  ['marketing/en/quickstart.html', 'https://nomiaqm.com/en/quickstart'],
]

test('public community links resolve to a real GitHub surface', () => {
  const source = [
    read('scripts/marketing/content.mjs'),
    read('README.md'),
    read('README.zh-CN.md'),
    read('.github/ISSUE_TEMPLATE/config.yml'),
    read('docs/guide/model-connection-en.md'),
  ].join('\n')
  assert.ok(source.includes(canonicalCommunityUrl))
  for (const file of ['marketing/index.html', 'marketing/en/index.html']) {
    assert.ok(read(file).includes(canonicalCommunityUrl), file)
  }
})

test('every indexed public page exposes a complete share and identity contract', () => {
  for (const [file, canonical] of pages) {
    const html = read(file)
    assert.match(html, /<meta name="description" content="[^"]+" \/>/, file)
    assert.ok(html.includes(`<link rel="canonical" href="${canonical}"`), file)
    assert.match(html, /<meta property="og:image:alt" content="[^"]+" \/>/, file)
    assert.match(html, /<meta name="twitter:card" content="summary_large_image" \/>/, file)
    assert.match(html, /<meta name="twitter:title" content="[^"]+" \/>/, file)
    assert.match(html, /<meta name="twitter:image:alt" content="[^"]+" \/>/, file)
    assert.match(html, /<script type="application\/ld\+json">[\s\S]+<\/script>/, file)
    assert.match(html, /"@type":"WebPage"/, file)
    assert.match(html, /"@type":"SoftwareApplication"/, file)
    assert.match(html, /"@id":"https:\/\/nomiaqm\.com\/#application"/, file)
    assert.match(html, new RegExp(`"softwareVersion":"${version.replaceAll('.', '\\.')}"`), file)
  }
})

test('sitemap contains only canonical public routes and current update dates', () => {
  const sitemap = read('marketing/sitemap.xml')
  for (const [, canonical] of pages) assert.match(sitemap, new RegExp(`<loc>${canonical.replaceAll('.', '\\.')}</loc>`))
  assert.doesNotMatch(sitemap, /discussions/)
  assert.doesNotMatch(sitemap, /<loc>https:\/\/nomiaqm\.com\/handbook<\/loc>/, 'the retired handbook route is gone from the sitemap')
})

test('SEO Observatory public paths all resolve to real generated pages', () => {
  const config = JSON.parse(read('docs/seo/config.json'))
  const { entries } = computeSitemapEntries({ siteData: loadSiteData(), runtimeFacts, previousDates: loadPageDates(), today: '2026-09-28' })
  const realPaths = new Set(entries.map((entry) => entry.path))
  assert.ok(config.publicPaths.length > 0, 'config.json lists at least one page to audit')
  for (const publicPath of config.publicPaths) assert.ok(realPaths.has(publicPath), `docs/seo/config.json publicPaths ${publicPath} is a real generated page`)
  assert.ok(!config.publicPaths.includes('/handbook'), 'the retired handbook is not in the audited path list')
})

test('the weekly SEO audit checks every page in the committed sitemap and needs no installed dependencies', async () => {
  const { loadMarketingPages } = await import('../../scripts/seo/seo-audit.mjs')
  const listed = (read('marketing/sitemap.xml').match(/<url>/g) || []).length
  assert.ok(listed > 100, 'the sitemap lists the libraries, not just the four onboarding pages')
  assert.equal(loadMarketingPages().length, listed)
  // .github/workflows/seo-radar.yml 不装依赖就直接跑 `pnpm seo:audit`：只要它没有安装步骤，
  // 这个脚本就只许 import Node 内置模块和一个零依赖的界限文件（给它加了依赖，每周巡检会在 CI 上悄悄变成 ERR_MODULE_NOT_FOUND）。
  if (!/pnpm install/.test(read('.github/workflows/seo-radar.yml'))) {
    const imports = [...read('scripts/seo/seo-audit.mjs').matchAll(/^import [^\n]* from '([^']+)'/gm)].map((match) => match[1])
    for (const specifier of imports) assert.ok(specifier.startsWith('node:') || specifier === '../marketing/seo-limits.mjs', `seo-audit.mjs may not import ${specifier} while the radar workflow installs nothing`)
    assert.doesNotMatch(read('scripts/marketing/seo-limits.mjs'), /^import /m, 'seo-limits.mjs stays dependency-free')
  }
})

test('public onboarding links use the final clean routes', () => {
  for (const file of ['marketing/index.html', 'marketing/en/index.html', 'marketing/quickstart.html', 'marketing/en/quickstart.html']) {
    const html = read(file)
    assert.doesNotMatch(html, /(?:href|canonical|og:url)=?["'][^"']*\/(?:quickstart|handbook)\.html/, file)
  }
})

test('the retired handbook page and its generator are gone, and the redirect target is /quickstart', () => {
  assert.ok(!fs.existsSync(path.join(root, 'marketing/handbook.html')), 'marketing/handbook.html no longer ships')
  assert.ok(!fs.existsSync(path.join(root, 'scripts/build-handbook-html.mjs')), 'the handbook generator is deleted')
  const redirects = read('marketing/_redirects')
  assert.match(redirects, /^\/handbook\s+\/quickstart\s+301\s*$/m, '/handbook redirects to /quickstart')
  assert.match(redirects, /^\/handbook\.html\s+\/quickstart\s+301\s*$/m, '/handbook.html redirects to /quickstart')
})

test('robots.txt explicitly allows search and AI answer crawlers and matches its generator', async () => {
  const { renderRobotsTxt } = await import('../../scripts/build-marketing-sitemap.mjs')
  const robots = read('marketing/robots.txt')
  assert.equal(robots, renderRobotsTxt(shared.siteUrl), 'marketing/robots.txt matches renderRobotsTxt output')
  const requiredAgents = [
    'Googlebot',
    'Bingbot',
    'GPTBot',
    'OAI-SearchBot',
    'ChatGPT-User',
    'PerplexityBot',
    'ClaudeBot',
    'Google-Extended',
  ]
  for (const agent of requiredAgents) {
    assert.match(
      robots,
      new RegExp(`^User-agent:\\s*${agent.replaceAll('.', '\\.')}\\nAllow:\\s*/\\s*$`, 'm'),
      `marketing/robots.txt explicitly allows ${agent}`,
    )
  }
  assert.match(robots, /^User-agent:\s*\*\nAllow:\s*\/\s*$/m, 'marketing/robots.txt keeps wildcard Allow: /')
  assert.match(robots, /^Sitemap:\s*https:\/\/nomiaqm\.com\/sitemap\.xml\s*$/m, 'marketing/robots.txt points to canonical sitemap')
})
