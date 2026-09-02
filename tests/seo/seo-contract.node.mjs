import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { shared } from '../../scripts/marketing/content.mjs'
import { marketingPages } from '../../scripts/marketing/site-manifest.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const version = JSON.parse(read('package.json')).version
const canonicalCommunityUrl = shared.discussionUrl

const pages = [
  ['marketing/index.html', 'https://nomiaqm.com/'],
  ['marketing/en/index.html', 'https://nomiaqm.com/en/'],
  ['marketing/quickstart.html', 'https://nomiaqm.com/quickstart'],
  ['marketing/handbook.html', 'https://nomiaqm.com/handbook'],
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
    assert.match(html, new RegExp(`"softwareVersion":"${version.replaceAll('.', '\\.') }"`), file)
  }
})

test('sitemap contains only canonical public routes and current update dates', () => {
  const sitemap = read('marketing/sitemap.xml')
  for (const [, canonical] of pages) assert.match(sitemap, new RegExp(`<loc>${canonical.replaceAll('.', '\\.')}</loc>`))
  assert.doesNotMatch(sitemap, /discussions/)
  assert.doesNotMatch(sitemap, /2026-07-06|2026-08-01/)
})

test('SEO Observatory public paths match the canonical marketing manifest', () => {
  const config = JSON.parse(read('docs/seo/config.json'))
  assert.deepEqual(config.publicPaths, marketingPages.map(({ path }) => path))
})

test('public onboarding links use the final clean routes', () => {
  for (const file of ['marketing/index.html', 'marketing/en/index.html', 'marketing/quickstart.html', 'marketing/handbook.html']) {
    const html = read(file)
    assert.doesNotMatch(html, /(?:href|canonical|og:url)=?["'][^"']*\/(?:quickstart|handbook)\.html/, file)
  }
  const handbook = read('marketing/handbook.html')
  assert.match(handbook, /href="\/quickstart"/, 'handbook links to clean quickstart')
  assert.match(handbook, /github\.com\/aqm857886159\/Nomi\/discussions/, 'handbook links to Discussions')
})
