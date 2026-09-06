import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const expect = (value, message) => {
  if (!value) throw new Error(`MARKETING HOME FAIL: ${message}`)
}
const expectBefore = (document, token, boundary, message) => {
  const tokenIndex = document.indexOf(token)
  const boundaryIndex = document.indexOf(boundary)
  expect(tokenIndex >= 0 && boundaryIndex >= 0 && tokenIndex < boundaryIndex, message)
}
const expectMobileSafeConversion = (document, heading, boundary, language) => {
  const startIndex = document.indexOf(heading)
  const boundaryIndex = document.indexOf(boundary)
  expect(startIndex >= 0 && boundaryIndex > startIndex, `${language} conversion block is bounded`)
  const conversion = document.slice(startIndex, boundaryIndex)
  const groupImage = conversion.match(/<img src="docs\/media\/nomi-canvas-group-wechat-2026-09-01\.jpg"[^>]*>/)?.[0]
  expect(groupImage && /width="2\d{2}"/.test(groupImage), `${language} group QR remains prominent on mobile`)
  expect(!conversion.includes('|:---'), `${language} conversion avoids a shrinking Markdown table`)
  expectBefore(
    conversion,
    'docs/media/nomi-canvas-group-wechat-2026-09-01.jpg',
    'docs/media/qingyang-wechat.jpg',
    `${language} puts the user-group QR before maintainer contact`,
  )
}

const zh = read('marketing/index.html')
const en = read('marketing/en/index.html')
const sitemap = read('marketing/sitemap.xml')
const headers = read('marketing/_headers')
const readmeEn = read('README.md')
const readmeZh = read('README.zh-CN.md')
const quickstart = read('marketing/quickstart.html')
const releaseVersion = JSON.parse(read('package.json')).version
const files = [
  'marketing/assets/video/launch-film-en.mp4',
  'marketing/assets/video/launch-film-zh.vtt',
  'marketing/assets/video/launch-film-en.vtt',
  'marketing/assets/video/hero-poster.jpg',
  'marketing/assets/demo.mp4',
  'marketing/assets/social-preview-zh.jpg',
  'marketing/assets/social-preview-en.jpg',
  'marketing/assets/group-wechat-2026-09-01.jpg',
  'marketing/assets/qingyang-wechat.jpg',
  'marketing/assets/screen-script-2026-08-17.png',
  'marketing/assets/screen-canvas-2026-08-17.png',
  'marketing/assets/screen-timeline-2026-08-17.png',
  'marketing/assets/screen-3d-2026-08-17.png',
  'marketing/assets/screen-agentic-2026-08-17.png',
  'docs/media/nomi-canvas-group-wechat-2026-09-01.jpg',
  'docs/media/qingyang-wechat.jpg',
  '.github/ISSUE_TEMPLATE/business_inquiry.yml',
  'marketing/quickstart.html',
  'marketing/handbook.html',
]

expect(/<html lang="zh-CN">/.test(zh), 'Chinese lang is static')
expect(/<html lang="en">/.test(en), 'English lang is static')
expect(zh.includes('把 AI 视频的成本，') && zh.includes('打下来。'), 'Chinese cost claim exists')
expect(en.includes('Bring the cost of AI video') && en.includes('down.'), 'English cost claim exists')
expect(!zh.includes('把镜头讲清楚') && !en.includes('Direct the shot.'), 'old hero claim is removed')

for (const html of [zh, en]) {
  for (const section of ['cost', 'workflow', 'open', 'start', 'community']) {
    expect(html.includes(`id="${section}"`), `${section} section exists in both locales`)
  }
  expect((html.match(/<h1>/g) || []).length === 1, 'exactly one H1 per locale')
  expect((html.match(/role="tab"/g) || []).length === 8, 'cost and workflow expose eight semantic tabs')
  expect(
    html.includes('aria-controls="cost-panel"') && html.includes('aria-controls="workflow-panel"'),
    'tab panels are associated',
  )
  expect(
    html.includes('class="hero-actions"'),
    'hero actions remain present',
  )
  expect(html.includes('data-github-hero'), 'hero GitHub CTA is marked for verification')
  expect(html.includes('https://github.com/aqm857886159/Nomi'), 'hero GitHub CTA uses the canonical repository')
  expect(html.includes('target="_blank" rel="noreferrer"'), 'hero GitHub CTA opens an external repository safely')
  expect(!html.includes('data-open-dialog="launch-film"'), 'hero no longer opens the 60-second workflow dialog')
  expect(
    !html.includes('观看 60 秒工作流') && !html.includes('Watch the 60s workflow'),
    '60-second hero copy is removed',
  )
  expect(
    !html.includes('OPEN-SOURCE · LOCAL-FIRST · AI VIDEO WORKBENCH'),
    'hero-only generic English float label is removed',
  )
  expect(html.includes('<dialog id="author-dialog"'), 'maintainer contact dialog exists')
  expect(html.includes('<dialog id="download-dialog"'), 'ambiguous platforms get an in-page download chooser')
  expect(
    (html.match(/data-mac-install-guide/g) || []).length === 2,
    'dialog and no-JS fallback explain macOS first launch',
  )
  expect(
    html.includes('xattr -dr com.apple.quarantine "/Applications/Nomi.app"'),
    'macOS damaged-app recovery uses the scoped quarantine command',
  )
  expect(!html.includes('spctl --master-disable'), 'macOS guidance never disables Gatekeeper globally')
  expect(
    html.includes('<div class="workflow-image-frame"><img id="workflow-image"'),
    'workflow screenshot uses a bounded media frame',
  )
  expect(
    (html.match(/data-download-nomi href="#download-options"/g) || []).length === 3,
    'all primary download buttons use the in-page fallback',
  )
  expect(
    (html.match(/data-direct-download href=/g) || []).length === 6,
    'dialog and no-JS fallback both expose three direct installers',
  )
  expect(
    !/<a[^>]+href="https:\/\/github\.com\/aqm857886159\/Nomi\/releases\/latest"/.test(html),
    'no download button links to the Releases listing',
  )
  for (const installer of ['Nomi-windows-setup.exe', 'Nomi-mac-arm64.dmg', 'Nomi-mac-intel.dmg']) {
    expect(html.includes(`/releases/latest/download/${installer}`), `${installer} direct link exists`)
  }
  expect(html.includes('business_inquiry.yml'), 'business CTA destination exists')
  expect(html.includes('/assets/group-wechat-2026-09-01.jpg'), 'new group QR is used')
  expect(
    html.includes('<figure class="community-qr" id="community-qr"><img'),
    'group QR is directly rendered in the page',
  )
  expect(!html.includes('data-open-dialog="group'), 'group QR does not require a dialog trigger')
  expect(html.includes('/assets/qingyang-wechat.jpg'), 'maintainer QR destination exists')
  expect(html.includes('/assets/nomi-logo.svg'), 'official Nomi mark is used')
  expect(html.includes('macOS 12+'), 'macOS minimum version is explicit')
  expect(html.includes(`"softwareVersion":"${releaseVersion}"`), 'structured data matches the release version')
  expect(
    html.includes('navigator.languages') && html.includes('find(Boolean)'),
    'browser locale priority logic is embedded',
  )
  expectBefore(
    html,
    "if (location.pathname !== '/') return",
    '<link rel="stylesheet"',
    'browser locale resolves before styles and body can paint',
  )
  expect(html.includes('localStorage.setItem(localeKey'), 'explicit locale preference is persisted')
  expect(html.includes("params.get('download') === '1'"), 'one-shot website download intent is embedded')
  expect(
    html.includes("for (const key of ['download', 'source', 'platform', 'arch'])"),
    'one-shot download parameters are cleared',
  )
  expect(
    !html.includes('/assets/screen-canvas.png') && !html.includes('/assets/screen-agentic.jpg'),
    'old product screenshots are not referenced',
  )
  for (const screenshot of ['script', 'canvas', 'timeline', '3d', 'agentic']) {
    expect(html.includes(`/assets/screen-${screenshot}-2026-08-17.png`), `${screenshot} screenshot is current`)
  }
}

expect(
  zh.includes('即梦高级会员') && zh.includes('本机 ComfyUI'),
  'Chinese bring-your-own capability claim is explicit',
)
expect(
  en.includes('Dreamina subscription') && en.includes('local ComfyUI'),
  'English bring-your-own capability claim is explicit',
)
expect(
  zh.includes('Codex、Claude Code、Cursor') && zh.includes('MCP 与 Skills'),
  'Chinese agentic workflow is explicit',
)
expect(
  en.includes('Codex, Claude Code, and Cursor') && en.includes('MCP and Skills'),
  'English agentic workflow is explicit',
)
expect(zh.includes('TZ857886159') && en.includes('TZ857886159'), 'direct WeChat fallback is textual')
expect(zh.includes('/en/') && en.includes('href="/"'), 'locale switch uses real locale URLs')
expect(zh.includes('rel="canonical" href="https://nomiaqm.com/"'), 'Chinese canonical')
expect(en.includes('rel="canonical" href="https://nomiaqm.com/en/"'), 'English canonical')
for (const html of [zh, en]) {
  expect((html.match(/hreflang=/g) || []).length === 3, 'three reciprocal hreflang links')
  expect(html.includes('https://www.gnu.org/licenses/agpl-3.0.html'), 'AGPL metadata URL')
  expect(!html.includes('https://www.apache.org/licenses/LICENSE-2.0'), 'no current Apache metadata')
}

for (const relativePath of files) expect(fs.existsSync(path.join(root, relativePath)), `${relativePath} exists`)
expect(
  fs
    .readFileSync(path.join(root, 'marketing/assets/group-wechat-2026-09-01.jpg'))
    .equals(fs.readFileSync(path.join(root, 'docs/media/nomi-canvas-group-wechat-2026-09-01.jpg'))),
  'website and README publish the identical current group QR',
)
expect(
  !zh.includes('/assets/group-wechat-2026-08-14.png') && !en.includes('/assets/group-wechat-2026-08-14.png'),
  'old group QR is not published by the homepage',
)
expect(!fs.existsSync(path.join(root, 'marketing/assets/demo.gif')), 'legacy demo GIF remains removed')
expect(!fs.existsSync(path.join(root, 'marketing/assets/vendor/gsap.min.js')), 'GSAP remains removed')
expect(!fs.existsSync(path.join(root, 'marketing/assets/vendor/ScrollTrigger.min.js')), 'ScrollTrigger remains removed')

expect(sitemap.includes('<loc>https://nomiaqm.com/en/</loc>'), 'English route is in sitemap')
expect(sitemap.includes('<loc>https://nomiaqm.com/quickstart</loc>'), 'clean quickstart route is in sitemap')
expect(sitemap.includes('<loc>https://nomiaqm.com/handbook</loc>'), 'clean handbook route is in sitemap')
expect(!sitemap.includes('/quickstart.html') && !sitemap.includes('/handbook.html'), 'legacy onboarding routes are absent from sitemap')
expect((zh.match(/<meta property="og:locale"/g) || []).length === 1, 'one Chinese OG locale')
expect((en.match(/<meta property="og:locale"/g) || []).length === 1, 'one English OG locale')
expect(zh.includes('social-preview-zh.jpg'), 'Chinese social card')
expect(en.includes('social-preview-en.jpg'), 'English social card')
expect(headers.includes('/en/index.html'), 'English HTML cache rule')
expect(
  headers.includes('/assets/video/*') && headers.includes('max-age=3600, must-revalidate'),
  'stable media filenames revalidate',
)

for (const label of ['加入用户群', '团队合作', '夸克网盘镜像', 'TZ857886159']) {
  expect(readmeZh.includes(label), `Chinese README conversion survives: ${label}`)
}
expect(
  readmeZh.includes('docs/media/nomi-canvas-group-wechat-2026-09-01.jpg'),
  'Chinese README uses the current group QR',
)
expect(readmeZh.includes('docs/media/qingyang-wechat.jpg'), 'Chinese README keeps maintainer QR')
expect(readmeZh.includes('business_inquiry.yml'), 'Chinese README keeps business inquiry')
for (const label of [
  'Community',
  'For Teams',
  'Custom builds',
  'Integrations',
  'AGPL-compliant deployment',
  'Ongoing iteration',
]) {
  expect(readmeEn.includes(label), `English README conversion survives: ${label}`)
}
expect(
  readmeEn.includes('docs/media/nomi-canvas-group-wechat-2026-09-01.jpg'),
  'English README uses the current group QR',
)
expect(readmeEn.includes('github.com/aqm857886159/Nomi/discussions'), 'English README keeps GitHub Discussions')
expect(readmeEn.includes('business_inquiry.yml'), 'English README keeps business inquiry')
expect(readmeEn.includes('[Download](#download)'), 'English README download shortcut leads to direct installers')
expect(readmeZh.includes('[下载](#下载)'), 'Chinese README download shortcut leads to direct installers')
expect(readmeEn.includes('Windows 10 / 11 x64'), 'English README labels the Windows architecture')
expect(readmeEn.includes('not Apple Developer ID signed or notarized'), 'English README discloses macOS signing status')
expect(readmeEn.includes('no Authenticode signature'), 'English README discloses Windows signing status')
expect(readmeEn.includes('System Settings → Privacy & Security'), 'English README prefers the supported macOS opening flow')
expect(readmeZh.includes('“系统设置”→“隐私与安全”'), 'Chinese README prefers the supported macOS opening flow')
for (const readme of [readmeEn, readmeZh]) {
  expect(
    readme.includes('xattr -dr com.apple.quarantine "/Applications/Nomi.app"'),
    'README damaged-app recovery uses the scoped quarantine command',
  )
  expect(!readme.includes('spctl --master-disable'), 'README never disables Gatekeeper globally')
}
expect(
  readmeEn.includes('Linux, Windows arm64, and macOS universal installers are not currently published'),
  'English README scopes supported release targets',
)
expect(quickstart.includes(`data-latest-version>v${releaseVersion}<`), 'quickstart fallback version matches the release')
expect(quickstart.includes(`"softwareVersion":"${releaseVersion}"`), 'quickstart structured data matches the release version')
expect(quickstart.includes('macOS 12+'), 'quickstart states the macOS minimum version')

const readmeHero = '[![Nomi director workflow]'
const readmeZhHero = '[![Nomi 导演工作流]'
for (const [token, label] of [
  ['<img src="docs/media/nomi-canvas-group-wechat-2026-09-01.jpg"', 'group QR'],
  ['<img src="docs/media/qingyang-wechat.jpg"', 'maintainer QR'],
  ['TZ857886159', 'textual WeChat fallback'],
]) {
  expectBefore(readmeEn, token, readmeHero, `English default README keeps ${label} before hero`)
  expectBefore(readmeZh, token, readmeZhHero, `Chinese README keeps ${label} before hero`)
}
expectMobileSafeConversion(readmeEn, '## WeChat / 微信联系', readmeHero, 'English default README')
expectMobileSafeConversion(readmeZh, '## 微信联系', readmeZhHero, 'Chinese README')

console.log('MARKETING HOME STATIC PASS')
