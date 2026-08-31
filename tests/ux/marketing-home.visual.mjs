import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const marketingRoot = path.join(repoRoot, 'marketing')
const shotsDir = path.join(repoRoot, 'tests/ux/_marketing')
fs.mkdirSync(shotsDir, { recursive: true })

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.mp4', 'video/mp4'],
  ['.vtt', 'text/vtt; charset=utf-8'],
])

function assert(condition, label) {
  if (!condition) throw new Error(`MARKETING HOME VISUAL FAIL: ${label}`)
  console.log(`  ✓ ${label}`)
}

function resolveRequestPath(urlPath) {
  const pathname = decodeURIComponent(urlPath)
  const relative = pathname === '/' ? 'index.html' : pathname === '/en/' ? 'en/index.html' : pathname.replace(/^\/+/, '')
  const resolved = path.resolve(marketingRoot, relative)
  const insideRoot = resolved === marketingRoot || resolved.startsWith(`${marketingRoot}${path.sep}`)
  return insideRoot ? resolved : null
}

const server = createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1')
  const filePath = resolveRequestPath(url.pathname)
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    response.writeHead(404)
    response.end('not found')
    return
  }
  const stat = fs.statSync(filePath)
  const contentType = contentTypes.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream'
  const range = request.headers.range
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range)
    const start = match ? Number(match[1]) : 0
    const end = match?.[2] ? Number(match[2]) : stat.size - 1
    if (!match || start > end || end >= stat.size) {
      response.writeHead(416, { 'content-range': `bytes */${stat.size}` })
      response.end()
      return
    }
    response.writeHead(206, {
      'accept-ranges': 'bytes',
      'content-range': `bytes ${start}-${end}/${stat.size}`,
      'content-length': end - start + 1,
      'content-type': contentType,
    })
    fs.createReadStream(filePath, { start, end }).pipe(response)
    return
  }
  response.writeHead(200, { 'content-length': stat.size, 'content-type': contentType })
  fs.createReadStream(filePath).pipe(response)
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()
const baseUrl = `http://127.0.0.1:${port}`

const cases = [
  { name: 'zh-desktop', path: '/', locale: 'zh-CN', viewport: { width: 1440, height: 900 } },
  { name: 'en-desktop', path: '/en/', locale: 'en-US', viewport: { width: 1440, height: 900 } },
  { name: 'zh-mobile', path: '/', locale: 'zh-CN', viewport: { width: 390, height: 844 } },
  { name: 'en-mobile', path: '/en/', locale: 'en-US', viewport: { width: 390, height: 844 } },
  { name: 'en-320', path: '/en/', locale: 'en-US', viewport: { width: 320, height: 760 } },
]

async function auditStandardCase(browser, testCase) {
  const context = await browser.newContext({ locale: testCase.locale, viewport: testCase.viewport })
  const page = await context.newPage()
  await page.goto(`${baseUrl}${testCase.path}`, { waitUntil: 'networkidle' })
  const facts = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    h1Count: document.querySelectorAll('h1').length,
    product: Boolean(document.querySelector('#product')),
    teams: Boolean(document.querySelector('#teams')),
    community: Boolean(document.querySelector('#community')),
    communityNav: Boolean(document.querySelector('a.nav-link[href="#community"]')),
    communityCards: document.querySelectorAll('[data-community-card]').length,
    groupQrLink: Boolean(document.querySelector('a[href="/assets/group-wechat-2026-08-25.png"]')),
    authorQrLink: Boolean(document.querySelector('a[href="/assets/qingyang-wechat.jpg"]')),
    businessLink: Boolean(document.querySelector('a[href*="business_inquiry.yml"]')),
    discussionsLink: Boolean(document.querySelector('a[href*="/discussions"]')),
    wechatText: (document.body.textContent || '').includes('TZ857886159'),
    proofs: document.querySelectorAll('[data-proof]').length,
    services: document.querySelectorAll('[data-service]').length,
    download: Array.from(document.querySelectorAll('a')).some((link) => /Download|下载/.test(link.textContent || '') && /releases\/latest/.test(link.href)),
    github: Array.from(document.querySelectorAll('a')).some((link) => link.textContent?.trim() === 'GitHub'),
    localeLink: Boolean(document.querySelector('[data-locale-choice]')),
    heroMedia: Boolean(document.querySelector('[data-hero-video][poster="/assets/video/hero-poster.jpg"]')),
    logoLoaded: (document.querySelector('.brand-logo')?.naturalWidth || 0) > 0,
    proofImagesLoaded: Array.from(document.querySelectorAll('[data-proof] img')).every((image) => image.naturalWidth > 0),
    proofAspectRatios: Array.from(document.querySelectorAll('[data-proof] img')).map((image) => {
      const box = image.getBoundingClientRect()
      return box.width / box.height
    }),
  }))
  assert(facts.overflow <= 1, `${testCase.name}: no horizontal overflow`)
  assert(facts.h1Count === 1, `${testCase.name}: exactly one H1`)
  assert(facts.product && facts.teams, `${testCase.name}: product and teams sections`)
  assert(facts.community && facts.communityNav && facts.communityCards === 2, `${testCase.name}: existing-design community section`)
  assert(facts.groupQrLink && facts.authorQrLink && facts.businessLink, `${testCase.name}: durable conversion destinations`)
  if (testCase.path === '/en/') assert(facts.discussionsLink, `${testCase.name}: international community destination`)
  if (testCase.path === '/') assert(facts.wechatText, `${testCase.name}: direct Chinese contact remains textual`)
  assert(facts.proofs === 4 && facts.services === 4, `${testCase.name}: four proofs and four services`)
  assert(facts.download && facts.github && facts.localeLink, `${testCase.name}: primary destinations exist`)
  assert(facts.heroMedia && facts.logoLoaded, `${testCase.name}: hero media and official logo render`)
  assert(facts.proofImagesLoaded, `${testCase.name}: every real product proof renders`)
  assert(facts.proofAspectRatios.every((ratio) => ratio >= 1.7 && ratio <= 1.82), `${testCase.name}: product proofs stay 16:9`)
  await page.screenshot({ path: path.join(shotsDir, `home-${testCase.name}.png`), fullPage: true })

  if (testCase.name === 'zh-desktop') {
    const popupPromise = page.waitForEvent('popup')
    await page.locator('a[href="/assets/group-wechat-2026-08-25.png"]').click()
    const qrPage = await popupPromise
    await qrPage.waitForLoadState('load')
    const dimensions = await qrPage.locator('img').evaluate((image) => ({
      width: image.naturalWidth,
      height: image.naturalHeight,
    }))
    assert(qrPage.url() === `${baseUrl}/assets/group-wechat-2026-08-25.png`, 'group QR opens the versioned asset')
    assert(dimensions.width === 1050 && dimensions.height === 1566, 'group QR renders at its real dimensions')
    await qrPage.screenshot({ path: path.join(shotsDir, 'group-qr-2026-08-25.png'), fullPage: true })
    await qrPage.close()
  }

  await page.locator('[data-open-film]').click()
  await page.locator('#launch-film').waitFor({ state: 'visible' })
  const track = await page.locator('#launch-film track').getAttribute('src')
  const expectedTrack = testCase.path === '/en/' ? '/assets/video/launch-film-en.vtt' : '/assets/video/launch-film-zh.vtt'
  assert(track === expectedTrack, `${testCase.name}: locale-matching captions`)
  await page.keyboard.press('Escape')
  await page.locator('#launch-film').waitFor({ state: 'hidden' })
  await context.close()
}

async function auditNoJavaScript(browser, pathName, locale, claim) {
  const context = await browser.newContext({ javaScriptEnabled: false, locale, viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  await page.goto(`${baseUrl}${pathName}`, { waitUntil: 'networkidle' })
  const h1 = (await page.locator('h1').textContent()) || ''
  const download = await page.locator('a[href*="releases/latest"]').count()
  const watchHref = await page.locator('[data-open-film]').getAttribute('href')
  const community = await page.locator('#community').count()
  const business = await page.locator('a[href*="business_inquiry.yml"]').count()
  assert(h1.includes(claim), `${locale}: no-JS H1 remains`)
  assert(download > 0 && Boolean(watchHref?.endsWith('.mp4')), `${locale}: no-JS download and direct film link remain`)
  assert(community === 1 && business > 0, `${locale}: no-JS conversion paths remain`)
  await context.close()
}

async function auditReducedMotion(browser) {
  const context = await browser.newContext({ locale: 'zh-CN', reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.querySelector('[data-hero-video]')?.paused === true)
  const boxes = await page.locator('main section').evaluateAll((sections) => sections.map((section) => section.getBoundingClientRect().height))
  assert(boxes.every((height) => height > 0), 'reduced motion: every section has layout')
  await page.screenshot({ path: path.join(shotsDir, 'home-reduced-motion.png'), fullPage: true })
  await context.close()
}

async function auditBlockedMedia(browser) {
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 900 } })
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort())
  await context.route(/\/assets\/video\//, (route) => route.abort())
  const page = await context.newPage()
  await page.goto(`${baseUrl}/en/`, { waitUntil: 'networkidle' })
  const facts = await page.evaluate(() => ({
    h1: document.querySelector('h1')?.textContent || '',
    heroLabel: document.querySelector('[data-hero-video]')?.getAttribute('aria-label') || '',
    download: Boolean(document.querySelector('a[href*="releases/latest"]')),
    teams: Boolean(document.querySelector('#teams')),
    community: Boolean(document.querySelector('#community')),
    business: Boolean(document.querySelector('a[href*="business_inquiry.yml"]')),
    discussions: Boolean(document.querySelector('a[href*="/discussions"]')),
    wechatText: (document.body.textContent || '').includes('TZ857886159'),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }))
  assert(facts.h1.includes('Direct the shot') && facts.heroLabel.length > 0, 'blocked media: claim and media alternative remain')
  assert(facts.download && facts.teams && facts.overflow <= 1, 'blocked media: core journey remains usable')
  assert(facts.community && facts.business && facts.discussions, 'blocked media: community and business paths remain usable')
  await page.screenshot({ path: path.join(shotsDir, 'home-blocked-media.png'), fullPage: true })
  await context.close()
}

async function auditLocalePreference(browser) {
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  await page.goto(`${baseUrl}/`)
  await page.waitForURL(`${baseUrl}/en/`)
  assert(new URL(page.url()).pathname === '/en/', 'English browser preference redirects once')
  await page.locator('[data-locale-choice="zh-CN"]').first().click()
  await page.waitForURL(`${baseUrl}/`)
  await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' })
  assert(new URL(page.url()).pathname === '/', 'explicit Chinese choice overrides browser preference')
  assert(await page.locator('html[lang="zh-CN"]').count() === 1, 'explicit Chinese choice keeps Chinese document')
  await context.close()
}

const browser = await chromium.launch({ headless: true })
try {
  for (const testCase of cases) await auditStandardCase(browser, testCase)
  await auditNoJavaScript(browser, '/', 'zh-CN', '把镜头讲清楚')
  await auditNoJavaScript(browser, '/en/', 'en-US', 'Direct the shot')
  await auditReducedMotion(browser)
  await auditBlockedMedia(browser)
  await auditLocalePreference(browser)
  console.log('\nMARKETING HOME VISUAL PASS')
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
