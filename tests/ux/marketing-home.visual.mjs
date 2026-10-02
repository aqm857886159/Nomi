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
  const relative =
    pathname === '/' ? 'index.html' : pathname === '/en/' ? 'en/index.html' : pathname.replace(/^\/+/, '')
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
  { name: 'zh-desktop', path: '/', locale: 'zh-CN', viewport: { width: 1440, height: 1000 } },
  { name: 'en-desktop', path: '/en/', locale: 'en-US', viewport: { width: 1440, height: 1000 } },
  { name: 'zh-mobile', path: '/', locale: 'zh-CN', viewport: { width: 390, height: 844 } },
  { name: 'en-mobile', path: '/en/', locale: 'en-US', viewport: { width: 390, height: 844 } },
  { name: 'en-320', path: '/en/', locale: 'en-US', viewport: { width: 320, height: 760 } },
]

async function auditStandardCase(browser, testCase) {
  const context = await browser.newContext({ locale: testCase.locale, viewport: testCase.viewport })
  const page = await context.newPage()
  const browserErrors = []
  page.on('pageerror', (error) => browserErrors.push(String(error)))
  await page.goto(`${baseUrl}${testCase.path}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(650)
  await page.screenshot({ path: path.join(shotsDir, `home-${testCase.name}-first.png`) })

  const facts = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    lang: document.documentElement.lang,
    h1Count: document.querySelectorAll('h1').length,
    sections: ['price', 'features', 'open', 'community'].every((id) => Boolean(document.getElementById(id))),
    groupQrVisible: (() => {
      const qr = document.querySelector('#community-qr')
      if (!qr) return false
      const style = getComputedStyle(qr)
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0
    })(),
    groupQrSource: document.querySelector('#community-qr img')?.getAttribute('src') || '',
    groupQrSize: (() => {
      const image = document.querySelector('#community-qr img')
      return image ? [image.naturalWidth, image.naturalHeight] : [0, 0]
    })(),
    businessLink: Boolean(document.querySelector('a[href*="business_inquiry.yml"]')),
    discussionsLink: Boolean(document.querySelector('a[href*="/issues"]')),
    wechatText: (document.body.textContent || '').includes('TZ857886159'),
    filmPlayer: Boolean(document.querySelector('.hero video[data-film][controls][poster]')) && Boolean(document.querySelector('.hero [data-film-play]:not([hidden])')),
    segments: Array.from(document.querySelectorAll('video[data-segment]')).map((video) => ({
      start: Number(video.dataset.start),
      end: Number(video.dataset.end),
      poster: video.getAttribute('poster') || '',
    })),
    downloadTriggers: document.querySelectorAll('[data-download-nomi]').length,
    directDownloadOptions: document.querySelectorAll('[data-direct-download]').length,
    heroGithub: (() => {
      const link = document.querySelector('[data-github-hero]')
      const download = document.querySelector('.hero-actions [data-download-nomi]')
      if (!link || !download) return false
      const style = getComputedStyle(link)
      const downloadStyle = getComputedStyle(download)
      const downloadRect = download.getBoundingClientRect()
      const linkRect = link.getBoundingClientRect()
      return Boolean(
        link.href === 'https://github.com/aqm857886159/Nomi' &&
          link.target === '_blank' &&
          link.rel.includes('noreferrer') &&
          style.borderColor !== downloadStyle.borderColor &&
          Math.abs(linkRect.height - downloadRect.height) <= 1 &&
          style.minHeight === downloadStyle.minHeight &&
          style.paddingLeft === downloadStyle.paddingLeft &&
          style.paddingRight === downloadStyle.paddingRight &&
          style.fontSize === downloadStyle.fontSize &&
          style.fontWeight === downloadStyle.fontWeight &&
          style.borderRadius === downloadStyle.borderRadius,
      )
    })(),
    heroFilmTrigger: Boolean(document.querySelector('.hero [data-open-dialog="launch-film"]')),
    heroMeta: Boolean(document.querySelector('.hero .hero-meta')),
    macNoticeVisible: (() => {
      const notice = document.querySelector('.mac-download-note')
      return Boolean(notice && getComputedStyle(notice).display !== 'none' && notice.getBoundingClientRect().height > 0)
    })(),
    releasesListingLinks: Array.from(document.querySelectorAll('a')).filter(
      (link) => link.href === 'https://github.com/aqm857886159/Nomi/releases/latest',
    ).length,
    localeLink: Boolean(document.querySelector('[data-locale-choice]')),
    localeLinkVisible: (() => {
      const link = document.querySelector('.nav-actions [data-locale-choice]')
      return Boolean(link && getComputedStyle(link).display !== 'none')
    })(),
    logoLoaded: (document.querySelector('.brand img')?.naturalWidth || 0) > 0,
    // 首屏片子窗口 + 六个功能段：都是 16:9 的有界画框，不让媒体霸占整屏。
    mediaFrames: Array.from(document.querySelectorAll('.film, .node-frame')).map((frame) => {
      const rect = frame.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    }),
  }))
  assert(facts.overflow <= 1, `${testCase.name}: no horizontal overflow`)
  assert(
    facts.lang === (testCase.path === '/en/' ? 'en' : 'zh-CN'),
    `${testCase.name}: static document language matches route`,
  )
  assert(facts.h1Count === 1 && facts.sections, `${testCase.name}: one H1 and complete information architecture`)
  assert(
    facts.groupQrVisible && facts.groupQrSource === '/assets/group-wechat-2026-10-09.jpg',
    `${testCase.name}: current group QR is directly visible`,
  )
  assert(
    facts.groupQrSize[0] === 1050 && facts.groupQrSize[1] === 1566,
    `${testCase.name}: group QR keeps the supplied asset dimensions`,
  )
  assert(
    facts.businessLink && facts.discussionsLink && facts.wechatText,
    `${testCase.name}: community and project fallbacks remain usable`,
  )
  assert(
    facts.filmPlayer &&
      facts.segments.length === 6 &&
      facts.segments.every((segment) => segment.start < segment.end && segment.end <= 90 && /\/assets\/promo-0\.22\/still-/.test(segment.poster)),
    `${testCase.name}: hero film player and six film segments exist`,
  )
  assert(
    facts.downloadTriggers === 2 &&
      facts.directDownloadOptions >= 3 &&
      facts.releasesListingLinks === 0 &&
      facts.localeLink &&
      facts.localeLinkVisible,
    `${testCase.name}: direct download path and visible locale switch exist`,
  )
  assert(
    facts.heroGithub && facts.heroMeta,
    `${testCase.name}: hero GitHub CTA matches download sizing and platform facts sit under it`,
  )
  assert(!facts.heroFilmTrigger, `${testCase.name}: retired launch-film dialog trigger stays removed`)
  assert(facts.macNoticeVisible, `${testCase.name}: macOS signing warning is visible before download`)
  assert(facts.logoLoaded, `${testCase.name}: logo renders`)
  assert(
    facts.mediaFrames.length === 7 &&
      facts.mediaFrames.every((frame) => frame.width > frame.height && Math.abs(frame.width / frame.height - 16 / 9) < 0.02),
    `${testCase.name}: film and every segment sit in a bounded 16:9 frame`,
  )
  const maxMediaHeight = Math.max(...facts.mediaFrames.map((frame) => frame.height))
  assert(
    maxMediaHeight <= (testCase.viewport.width <= 760 ? 360 : 620),
    `${testCase.name}: product media does not dominate the page vertically`,
  )
  assert(browserErrors.length === 0, `${testCase.name}: no page errors`)
  await page.screenshot({ path: path.join(shotsDir, `home-${testCase.name}.png`), fullPage: true })

  assert(await page.locator('[data-github-hero]').count() === 1, `${testCase.name}: one hero GitHub CTA exists`)

  if (testCase.name === 'zh-desktop') {
    // 首屏整片：点了才出声播放；功能段：滚到眼前自己在对应秒数里循环。
    // 点样张里那颗「播放宣传片（有声音）」：原生播放器开播，按钮自己消失。
    await page.locator('[data-film-play]').click()
    await page.waitForFunction(() => {
      const video = document.querySelector('.film-video')
      return Boolean(video && !video.paused && video.currentTime > 0.2)
    })
    assert(await page.locator('.film-video').evaluate((video) => !video.muted && video.controls), 'hero film plays with sound and controls once the user starts it')
    assert((await page.locator('[data-film-play]').count()) === 0, 'the play pill steps aside once the film is playing')
    await page.locator('.film-video').evaluate((video) => video.pause())
    const storyboard = page.locator('[data-feature="storyboard"] video')
    await storyboard.scrollIntoViewIfNeeded()
    await page.waitForFunction(() => {
      const video = document.querySelector('[data-feature="storyboard"] video')
      return Boolean(video && !video.paused && video.currentTime >= Number(video.dataset.start))
    })
    const segmentTime = await storyboard.evaluate((video) => ({ t: video.currentTime, start: Number(video.dataset.start), end: Number(video.dataset.end), muted: video.muted }))
    assert(
      segmentTime.muted && segmentTime.t >= segmentTime.start && segmentTime.t <= segmentTime.end + 0.5,
      'feature segment plays muted inside its own seconds of the film',
    )

    await page.getByRole('button', { name: '添加维护者微信' }).click()
    assert(await page.locator('#author-dialog').isVisible(), 'maintainer WeChat dialog opens')
    await page.locator('#author-dialog .dialog-close').click()
    assert(!(await page.locator('#author-dialog').isVisible()), 'maintainer WeChat dialog closes')

    await page.locator('#nav-links a[href="#community"]').click()
    // 平滑滚动：等二维码真的进了视口，而不是睡一段固定时间。
    await page.waitForFunction(() => {
      const rect = document.querySelector('#community-qr')?.getBoundingClientRect()
      return Boolean(rect && rect.top < innerHeight && rect.bottom > 0)
    })
    const qrInView = await page.locator('#community-qr').evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return rect.top < innerHeight && rect.bottom > 0
    })
    assert(qrInView && new URL(page.url()).hash === '#community', 'community nav link scrolls to the visible group QR')
    await page.screenshot({ path: path.join(shotsDir, 'home-zh-desktop-community.png') })
  }

  if (testCase.name === 'zh-mobile') {
    const menu = page.getByRole('button', { name: '菜单' })
    await menu.click()
    assert(
      (await menu.getAttribute('aria-expanded')) === 'true' && (await page.locator('#nav-links').isVisible()),
      'mobile menu opens',
    )
    await page.getByRole('link', { name: '社区', exact: true }).first().click()
    assert((await menu.getAttribute('aria-expanded')) === 'false', 'mobile menu closes after navigation')
    await page.locator('#community-qr').scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(shotsDir, 'home-zh-mobile-community.png') })

    await page.locator('.mac-download-note [data-open-dialog="download-dialog"]').click()
    await page.locator('#download-dialog').waitFor({ state: 'visible' })
    const guideFacts = await page.locator('#download-dialog').evaluate((dialog) => ({
      width: dialog.getBoundingClientRect().width,
      viewportWidth: document.documentElement.clientWidth,
      command: dialog.querySelector('.mac-install-command')?.textContent || '',
      commandFits: (() => {
        const command = dialog.querySelector('.mac-install-command')
        return Boolean(command && command.scrollWidth <= command.clientWidth + 1)
      })(),
      guide: dialog.querySelector('[data-mac-install-guide]')?.textContent || '',
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }))
    assert(
      guideFacts.width <= guideFacts.viewportWidth && guideFacts.overflow <= 1 && guideFacts.commandFits,
      'mobile macOS install dialog stays within the viewport',
    )
    assert(
      guideFacts.command.includes('xattr -dr com.apple.quarantine') && guideFacts.guide.includes('官方链接'),
      'mobile macOS install dialog shows the scoped command and official-source qualifier',
    )
    await page.screenshot({ path: path.join(shotsDir, 'home-zh-mobile-mac-install.png') })
    await page.locator('#download-dialog .dialog-close').click()
  }

  await context.close()
}

async function auditNoJavaScript(browser, pathName, locale, claim) {
  const context = await browser.newContext({ javaScriptEnabled: false, locale, viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  await page.goto(`${baseUrl}${pathName}`, { waitUntil: 'networkidle' })
  const h1 = (await page.locator('h1').textContent()) || ''
  const downloadTriggers = await page.locator('[data-download-nomi][href="#download-options"]').count()
  const directDownloads = await page.locator('[data-direct-download][href*="/releases/latest/download/"]').count()
  const releasesListing = await page.locator('a[href="https://github.com/aqm857886159/Nomi/releases/latest"]').count()
  const heroGithub = await page.locator('[data-github-hero]').count()
  const heroFilm = await page.locator('.hero [data-open-dialog="launch-film"]').count()
  const noScriptFilm = await page.locator('.hero video[data-film][controls]').count()
  const noScriptPill = await page.locator('.hero [data-film-play]').isVisible()
  const qr = await page.locator('#community-qr img').getAttribute('src')
  const business = await page.locator('a[href*="business_inquiry.yml"]').count()
  const installGuide = (await page.locator('.download-fallback [data-mac-install-guide]').textContent()) || ''
  assert(h1.includes(claim), `${locale}: no-JS H1 remains`)
  assert(
    downloadTriggers === 2 && directDownloads >= 3 && releasesListing === 0,
    `${locale}: no-JS direct downloads remain without a Releases detour`,
  )
  assert(heroGithub === 1 && heroFilm === 0 && noScriptFilm === 1 && !noScriptPill, `${locale}: no-JS hero keeps the GitHub path and a playable native film`)
  assert(qr === '/assets/group-wechat-2026-10-09.jpg' && business > 0, `${locale}: no-JS QR and project paths remain`)
  assert(
    installGuide.includes('xattr -dr com.apple.quarantine') && /official|官方/.test(installGuide),
    `${locale}: no-JS macOS recovery stays available and source-qualified`,
  )
  await context.close()
}

async function auditReducedMotion(browser) {
  const context = await browser.newContext({
    locale: 'zh-CN',
    reducedMotion: 'reduce',
    viewport: { width: 1440, height: 1000 },
  })
  const page = await context.newPage()
  await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' })
  // 减少动效档下页面根本不挂自动播放的观察器（client.mjs），滚过去立刻就能断言，不用等。
  await page.locator('[data-feature="agent"] video').scrollIntoViewIfNeeded()
  const facts = await page.evaluate(() => ({
    segments: Array.from(document.querySelectorAll('video[data-segment]')).map((video) => ({ paused: video.paused, controls: video.controls })),
    sectionHeights: Array.from(document.querySelectorAll('main section')).map(
      (section) => section.getBoundingClientRect().height,
    ),
  }))
  assert(
    facts.segments.length === 6 && facts.segments.every((segment) => segment.paused && segment.controls),
    'reduced motion: feature segments never autoplay and offer their own controls',
  )
  assert(
    facts.sectionHeights.every((height) => height > 0),
    'reduced motion: every section keeps layout',
  )
  await page.screenshot({ path: path.join(shotsDir, 'home-reduced-motion.png'), fullPage: true })
  await context.close()
}

async function auditBlockedMedia(browser) {
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 1000 } })
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort())
  await context.route(/\/assets\/video\//, (route) => route.abort())
  const page = await context.newPage()
  await page.goto(`${baseUrl}/en/`, { waitUntil: 'networkidle' })
  const facts = await page.evaluate(() => ({
    h1: document.querySelector('h1')?.textContent || '',
    download: Boolean(document.querySelector('[data-download-nomi]')),
    qr: document.querySelector('#community-qr img')?.getAttribute('src') || '',
    business: Boolean(document.querySelector('a[href*="business_inquiry.yml"]')),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }))
  assert(
    facts.h1.includes('Pro-grade AI video.') && facts.download,
    'blocked media: claim and primary action remain',
  )
  assert(
    facts.qr === '/assets/group-wechat-2026-10-09.jpg' && facts.business,
    'blocked media: community and project paths remain',
  )
  assert(facts.overflow <= 1, 'blocked media: layout remains stable')
  await page.screenshot({ path: path.join(shotsDir, 'home-blocked-media.png'), fullPage: true })
  await context.close()
}

async function auditDirectDownloads(browser) {
  const windowsContext = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 800 } })
  await windowsContext.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { configurable: true, get: () => 'Win32' })
    Object.defineProperty(navigator, 'userAgentData', { configurable: true, get: () => undefined })
  })
  const windowsPage = await windowsContext.newPage()
  const windowsUrl = 'https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-windows-setup.exe'
  let requestedWindowsUrl = ''
  await windowsPage.route(windowsUrl, (route) => {
    requestedWindowsUrl = route.request().url()
    route.abort()
  })
  await windowsPage.goto(`${baseUrl}/`, { waitUntil: 'networkidle' })
  await windowsPage.waitForFunction((url) => document.querySelector('[data-download-nomi]')?.href === url, windowsUrl)
  assert(
    (await windowsPage.locator('[data-download-nomi]').first().getAttribute('href')) === windowsUrl,
    'Windows download button resolves directly to the x64 installer',
  )
  await windowsPage.locator('[data-download-nomi]').first().click({ noWaitAfter: true })
  await windowsPage.waitForTimeout(300)
  assert(requestedWindowsUrl === windowsUrl, 'clicking Windows download requests the installer directly')
  await windowsContext.close()

  // 伪装 Mac 时连 userAgent 一起换：在 Windows 机器上跑时，真实 UA 里的 Windows 会先命中 Windows 分支。
  const macUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
  const armContext = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 800 }, userAgent: macUserAgent })
  await armContext.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { configurable: true, get: () => 'MacIntel' })
    Object.defineProperty(navigator, 'userAgentData', {
      configurable: true,
      get: () => ({ getHighEntropyValues: async () => ({ architecture: 'arm' }) }),
    })
  })
  const armPage = await armContext.newPage()
  await armPage.goto(`${baseUrl}/`, { waitUntil: 'networkidle' })
  const armUrl = 'https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-mac-arm64.dmg'
  await armPage.waitForFunction((url) => document.querySelector('[data-download-nomi]')?.href === url, armUrl)
  assert(
    (await armPage.locator('[data-download-nomi]').first().getAttribute('href')) === armUrl,
    'Apple silicon download button resolves directly to the arm64 installer',
  )
  await armContext.close()

  const ambiguousContext = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 800 }, userAgent: macUserAgent })
  await ambiguousContext.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { configurable: true, get: () => 'MacIntel' })
    Object.defineProperty(navigator, 'userAgentData', { configurable: true, get: () => undefined })
  })
  const ambiguousPage = await ambiguousContext.newPage()
  await ambiguousPage.goto(`${baseUrl}/`, { waitUntil: 'networkidle' })
  const beforeClick = ambiguousPage.url()
  await ambiguousPage.locator('[data-download-nomi]').first().click()
  await ambiguousPage.locator('#download-dialog').waitFor({ state: 'visible' })
  assert(ambiguousPage.url() === beforeClick, 'unknown Mac architecture keeps the user on the homepage')
  assert(
    (await ambiguousPage.locator('#download-dialog [data-direct-download]').count()) === 3,
    'unknown Mac architecture shows three direct installer choices in-page',
  )
  const macGuide = (await ambiguousPage.locator('#download-dialog [data-mac-install-guide]').textContent()) || ''
  assert(
    macGuide.includes('xattr -dr com.apple.quarantine') && macGuide.includes('官方链接'),
    'download chooser includes safe macOS first-launch recovery',
  )
  await ambiguousPage.screenshot({ path: path.join(shotsDir, 'home-download-chooser.png') })
  await ambiguousContext.close()
}

async function auditLocalePreference(browser) {
  const englishContext = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 } })
  const englishPage = await englishContext.newPage()
  await englishPage.goto(`${baseUrl}/`)
  await englishPage.waitForURL(`${baseUrl}/en/`)
  assert(new URL(englishPage.url()).pathname === '/en/', 'English browser preference redirects the default route once')
  await englishPage.locator('[data-locale-choice="zh-CN"]').first().click()
  await englishPage.waitForURL(`${baseUrl}/`)
  await englishPage.goto(`${baseUrl}/`, { waitUntil: 'networkidle' })
  assert(new URL(englishPage.url()).pathname === '/', 'explicit Chinese choice overrides browser preference')
  assert(
    (await englishPage.locator('html[lang="zh-CN"]').count()) === 1,
    'explicit Chinese choice keeps the Chinese document',
  )
  await englishContext.close()

  const priorityContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await priorityContext.addInitScript(() => {
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['en-US', 'zh-CN'] })
  })
  const priorityPage = await priorityContext.newPage()
  await priorityPage.goto(`${baseUrl}/`)
  await priorityPage.waitForURL(`${baseUrl}/en/`)
  assert(new URL(priorityPage.url()).pathname === '/en/', 'the first supported browser language wins')
  await priorityContext.close()

  const directContext = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 800 } })
  const directPage = await directContext.newPage()
  await directPage.goto(`${baseUrl}/en/#community`, { waitUntil: 'networkidle' })
  assert(new URL(directPage.url()).pathname === '/en/', 'a direct English URL is never overridden by browser language')
  const localeLink = directPage.locator('[data-locale-choice="zh-CN"]').first()
  assert((await localeLink.getAttribute('href')) === '/#community', 'language switch preserves the current section')
  await directContext.close()
}

const browser = await chromium.launch({ headless: true })
try {
  for (const testCase of cases) await auditStandardCase(browser, testCase)
  await auditNoJavaScript(browser, '/', 'zh-CN', '商业级体验，')
  await auditNoJavaScript(browser, '/en/', 'en-US', 'Pro-grade AI video.')
  await auditReducedMotion(browser)
  await auditBlockedMedia(browser)
  await auditDirectDownloads(browser)
  await auditLocalePreference(browser)
  console.log('\nMARKETING HOME VISUAL PASS')
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
