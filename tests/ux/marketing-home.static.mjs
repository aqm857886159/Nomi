import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 官网首页 + 快速上手 + README 的静态合同。
// 2026-09-27 用户拍板 0.22 改版（docs/plan/2026-09-27-promo-0.22-site-readme.md）：主张换成「商业级体验，模型按原价」，
// 功能段播放宣传片对应的秒数，README 的微信二维码从头图之前挪到「社区」一节。
// 下载直链、macOS 安全放行、无 JS 兜底、语言偏好、SEO、二维码与 README 同图这些功能/安全断言沿用旧版，不许放松。

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
/** README 的微信转化块：住在「社区」一节里，用户群码大图在前，维护者码在后，不用会缩小的 Markdown 表格。 */
const expectCommunityConversion = (document, heading, nextHeading, language) => {
  const startIndex = document.indexOf(heading)
  const boundaryIndex = document.indexOf(nextHeading, startIndex + heading.length)
  expect(startIndex >= 0 && boundaryIndex > startIndex, `${language} community block is bounded`)
  const conversion = document.slice(startIndex, boundaryIndex)
  const groupImage = conversion.match(/<img src="docs\/media\/nomi-canvas-group-wechat-[0-9]{4}-[0-9]{2}-[0-9]{2}\.jpg"[^>]*>/)?.[0]
  expect(groupImage && /width="2\d{2}"/.test(groupImage), `${language} group QR remains prominent on mobile`)
  expect(!conversion.includes('|:---'), `${language} conversion avoids a shrinking Markdown table`)
  expectBefore(
    conversion,
    'docs/media/nomi-canvas-group-wechat-2026-10-09.jpg',
    'docs/media/qingyang-wechat.jpg',
    `${language} puts the user-group QR before maintainer contact`,
  )
  expect(conversion.includes('TZ857886159'), `${language} community block keeps the textual WeChat fallback`)
}

const zh = read('marketing/index.html')
const en = read('marketing/en/index.html')
const zhQuickstart = read('marketing/quickstart.html')
const enQuickstart = read('marketing/en/quickstart.html')
const sitemap = read('marketing/sitemap.xml')
const headers = read('marketing/_headers')
const readmeEn = read('README.md')
const readmeZh = read('README.zh-CN.md')
const releaseVersion = JSON.parse(read('package.json')).version
const film = '/assets/video/nomi-0.22-film.mp4'
const files = [
  `marketing${film}`,
  'marketing/assets/promo-0.22/cover-zh-light.jpg',
  'marketing/assets/promo-0.22/cover-zh-dark.jpg',
  'marketing/assets/promo-0.22/cover-en-light.jpg',
  'marketing/assets/promo-0.22/cover-en-dark.jpg',
  'marketing/assets/promo-0.22/film-poster-zh.jpg',
  'marketing/assets/promo-0.22/film-poster-en.jpg',
  'marketing/assets/social-preview-zh.jpg',
  'marketing/assets/social-preview-en.jpg',
  'marketing/assets/group-wechat-2026-10-09.jpg',
  'marketing/assets/qingyang-wechat.jpg',
  'docs/media/nomi-canvas-group-wechat-2026-10-09.jpg',
  'docs/media/qingyang-wechat.jpg',
  '.github/ISSUE_TEMPLATE/business_inquiry.yml',
  'marketing/quickstart.html',
  'marketing/en/quickstart.html',
  'marketing/handbook.html',
]

expect(/<html lang="zh-CN">/.test(zh), 'Chinese lang is static')
expect(/<html lang="en">/.test(en), 'English lang is static')
expect(zh.includes('商业级体验，') && zh.includes('模型按原价。'), 'Chinese claim exists')
expect(en.includes('Pro-grade AI video.') && en.includes('Models at their real price.'), 'English claim exists')
expect(!zh.includes('把 AI 视频的成本') && !en.includes('Bring the cost of AI video'), 'old cost claim is removed')

for (const html of [zh, en]) {
  for (const section of ['price', 'features', 'open', 'community']) {
    expect(html.includes(`id="${section}"`), `${section} section exists in both locales`)
  }
  expect((html.match(/<h1[ >]/g) || []).length === 1, 'exactly one H1 per locale')
  expect(!html.includes('role="tab"'), 'retired cost/workflow tabs are gone')
  expect(html.includes('class="hero-actions"'), 'hero actions remain present')
  expect(html.includes('data-github-hero'), 'hero GitHub CTA is marked for verification')
  expect(html.includes('https://github.com/aqm857886159/Nomi'), 'hero GitHub CTA uses the canonical repository')
  expect(html.includes('target="_blank" rel="noreferrer"'), 'external links open safely')

  // 宣传片：首屏整片（点了才加载），功能段六段都指向同一个文件的不同秒数。
  // 原生播放器：preload=none 点了才加载，controls 自带播放与声音，不用 JS 也能看。
  expect(new RegExp(`<video class="film-video" data-film src="${film.replaceAll('.', '\\.')}" poster="[^"]+" controls preload="none"`).test(html), 'hero film is a native player that loads only on play')
  expect(html.includes('data-film-play hidden'), 'the approved play pill ships hidden and only appears when the script can drive it')
  expect(!html.includes('data-open-dialog="launch-film"'), 'retired launch-film dialog is not wired')
  const segments = [...html.matchAll(/<video class="segment" data-segment data-start="(\d+)" data-end="(\d+)" src="([^"]+)" poster="([^"]+)" muted playsinline preload="none"/g)]
  expect(segments.length === 6, 'six feature segments exist')
  for (const [, start, end, src, poster] of segments) {
    expect(Number(start) < Number(end) && Number(end) <= 90, `segment ${start}-${end} lies inside the 90-second film`)
    expect(src === `${film}#t=${start},${end}`, `segment ${start}-${end} plays its own seconds of the one film`)
    expect(fs.existsSync(path.join(root, 'marketing', poster)), `segment poster ${poster} exists`)
  }

  // 价格只做定性说法：两根条旁边必须说明是示意。
  expect(/示意，不是具体报价|Illustrative, not a quote/.test(html), 'price bars are labelled as illustrative')
  expect(!/[¥$]\s?\d/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'no hard price numbers on the page')

  expect(html.includes('<dialog id="author-dialog"'), 'maintainer contact dialog exists')
  expect(html.includes('<dialog id="download-dialog"'), 'ambiguous platforms get an in-page download chooser')
  expect((html.match(/data-mac-install-guide/g) || []).length === 2, 'dialog and no-JS fallback explain macOS first launch')
  expect(html.includes('xattr -dr com.apple.quarantine "/Applications/Nomi.app"'), 'macOS damaged-app recovery uses the scoped quarantine command')
  expect(!html.includes('spctl --master-disable'), 'macOS guidance never disables Gatekeeper globally')
  expect((html.match(/data-download-nomi href="#download-options"/g) || []).length === 2, 'nav and hero download buttons use the in-page fallback')
  expect((html.match(/data-direct-download href=/g) || []).length === 6, 'dialog and no-JS fallback both expose three direct installers')
  expect(!/<a[^>]+href="https:\/\/github\.com\/aqm857886159\/Nomi\/releases\/latest"/.test(html), 'no download button links to the Releases listing')
  for (const installer of ['Nomi-windows-setup.exe', 'Nomi-mac-arm64.dmg', 'Nomi-mac-intel.dmg']) {
    expect(html.includes(`/releases/latest/download/${installer}`), `${installer} direct link exists`)
  }
  expect(html.includes('business_inquiry.yml'), 'business CTA destination exists')
  expect(html.includes('/assets/group-wechat-2026-10-09.jpg'), 'current group QR is used')
  expect(html.includes('<figure class="qr" id="community-qr"><img'), 'group QR is directly rendered in the page')
  expect(!html.includes('data-open-dialog="group'), 'group QR does not require a dialog trigger')
  expect(html.includes('/assets/qingyang-wechat.jpg'), 'maintainer QR destination exists')
  expect(html.includes('/assets/nomi-logo.svg'), 'official Nomi mark is used')
  expect(html.includes('macOS 12+'), 'macOS minimum version is explicit')
  expect(html.includes(`"softwareVersion":"${releaseVersion}"`), 'structured data matches the release version')
  expect(html.includes('navigator.languages') && html.includes('find(Boolean)'), 'browser locale priority logic is embedded')
  expectBefore(html, "if (location.pathname !== '/') return", '<link rel="stylesheet"', 'browser locale resolves before styles and body can paint')
  expect(html.includes('localStorage.setItem(localeKey'), 'explicit locale preference is persisted')
  expect(html.includes("params.get('download') === '1'"), 'one-shot website download intent is embedded')
  expect(html.includes("for (const key of ['download', 'source', 'platform', 'arch'])"), 'one-shot download parameters are cleared')
  expect(html.includes("matchMedia('(prefers-reduced-motion: reduce)')"), 'feature segments respect reduced motion')
}

expect(zh.includes('即梦会员') && zh.includes('ComfyUI'), 'Chinese bring-your-own providers are explicit')
expect(en.includes('Dreamina membership') && en.includes('local ComfyUI'), 'English bring-your-own providers are explicit')
expect(zh.includes('Claude Code 或 Codex'), 'Chinese assisted model onboarding is explicit')
expect(en.includes('Claude Code or Codex'), 'English assisted model onboarding is explicit')
expect(zh.includes('TZ857886159') && en.includes('TZ857886159'), 'direct WeChat fallback is textual')
expect(zh.includes('href="/en/"') && en.includes('href="/"'), 'locale switch uses real locale URLs')
expect(zh.includes('rel="canonical" href="https://nomiaqm.com/"'), 'Chinese canonical')
expect(en.includes('rel="canonical" href="https://nomiaqm.com/en/"'), 'English canonical')

// 快速上手：中英两页，互为 hreflang，下载直链与版本号在页上。
expect(zhQuickstart.includes('rel="canonical" href="https://nomiaqm.com/quickstart"'), 'Chinese quickstart canonical')
expect(enQuickstart.includes('rel="canonical" href="https://nomiaqm.com/en/quickstart"'), 'English quickstart canonical')
for (const html of [zhQuickstart, enQuickstart]) {
  expect(html.includes('hreflang="zh-CN" href="https://nomiaqm.com/quickstart"') && html.includes('hreflang="en" href="https://nomiaqm.com/en/quickstart"'), 'quickstart pages point at each other')
  expect(html.includes(`data-latest-version>v${releaseVersion}<`), 'quickstart version matches the release')
  expect(html.includes(`"softwareVersion":"${releaseVersion}"`), 'quickstart structured data matches the release version')
  expect(html.includes('macOS 12+'), 'quickstart states the macOS minimum version')
  expect(!html.includes("if (location.pathname !== '/') return"), 'quickstart does not redirect by browser language')
  expect(!html.includes('data-segment') && !html.includes('author-dialog') && !html.includes('.feature {'), 'quickstart carries no homepage-only markup, script, or styles')
  expect(!/<a[^>]+href="https:\/\/github\.com\/aqm857886159\/Nomi\/releases\/latest"/.test(html), 'quickstart never links to the Releases listing for downloads')
}

for (const html of [zh, en, zhQuickstart, enQuickstart]) {
  expect((html.match(/hreflang=/g) || []).length === 3, 'three reciprocal hreflang links')
  expect(html.includes('https://www.gnu.org/licenses/agpl-3.0.html'), 'AGPL metadata URL')
  expect(!html.includes('https://www.apache.org/licenses/LICENSE-2.0'), 'no current Apache metadata')
  expect((html.match(/<meta property="og:locale"/g) || []).length === 1, 'one OG locale')
}

for (const relativePath of files) expect(fs.existsSync(path.join(root, relativePath)), `${relativePath} exists`)
expect(
  fs
    .readFileSync(path.join(root, 'marketing/assets/group-wechat-2026-10-09.jpg'))
    .equals(fs.readFileSync(path.join(root, 'docs/media/nomi-canvas-group-wechat-2026-10-09.jpg'))),
  'website and README publish the identical current group QR',
)
expect(!zh.includes('/assets/group-wechat-2026-08-14.png') && !en.includes('/assets/group-wechat-2026-08-14.png'), 'old group QR is not published by the homepage')
expect(fs.statSync(path.join(root, `marketing${film}`)).size < 15 * 1024 * 1024, 'the web film stays small enough for the static host')
expect(!fs.existsSync(path.join(root, 'marketing/assets/demo.gif')), 'legacy demo GIF remains removed')
expect(!fs.existsSync(path.join(root, 'marketing/assets/vendor/gsap.min.js')), 'GSAP remains removed')
expect(!fs.existsSync(path.join(root, 'marketing/assets/vendor/ScrollTrigger.min.js')), 'ScrollTrigger remains removed')

expect(sitemap.includes('<loc>https://nomiaqm.com/en/</loc>'), 'English route is in sitemap')
expect(sitemap.includes('<loc>https://nomiaqm.com/quickstart</loc>'), 'clean quickstart route is in sitemap')
expect(sitemap.includes('<loc>https://nomiaqm.com/en/quickstart</loc>'), 'English quickstart route is in sitemap')
expect(sitemap.includes('<loc>https://nomiaqm.com/handbook</loc>'), 'clean handbook route is in sitemap')
expect(!sitemap.includes('/quickstart.html') && !sitemap.includes('/handbook.html'), 'legacy onboarding routes are absent from sitemap')
expect(zh.includes('social-preview-zh.jpg') && zhQuickstart.includes('social-preview-zh.jpg'), 'Chinese social card')
expect(en.includes('social-preview-en.jpg') && enQuickstart.includes('social-preview-en.jpg'), 'English social card')
expect(headers.includes('/en/index.html'), 'English HTML cache rule')
expect(headers.includes('/assets/video/*') && headers.includes('max-age=3600, must-revalidate'), 'stable media filenames revalidate')

// README：中文保留夸克镜像与转化入口；英文保留社区与团队服务；两边都如实披露签名状态。
for (const label of ['加入用户群', '团队合作', '夸克网盘镜像', 'TZ857886159']) {
  expect(readmeZh.includes(label), `Chinese README conversion survives: ${label}`)
}
expect(readmeZh.includes('docs/media/qingyang-wechat.jpg'), 'Chinese README keeps maintainer QR')
expect(readmeZh.includes('business_inquiry.yml'), 'Chinese README keeps business inquiry')
for (const label of ['Community', 'For Teams', 'Custom builds', 'Integrations', 'AGPL-compliant deployment', 'Ongoing iteration']) {
  expect(readmeEn.includes(label), `English README conversion survives: ${label}`)
}
expect(readmeEn.includes('github.com/aqm857886159/Nomi/discussions'), 'English README keeps GitHub Discussions')
expect(readmeEn.includes('business_inquiry.yml'), 'English README keeps business inquiry')
expect(/href="#download"|\]\(#download\)/.test(readmeEn) && readmeEn.includes('## Download'), 'English README download shortcut leads to direct installers')
expect(/href="#下载"|\]\(#下载\)/.test(readmeZh) && readmeZh.includes('## 下载'), 'Chinese README download shortcut leads to direct installers')
expect(readmeEn.includes('Windows 10 / 11 x64'), 'English README labels the Windows architecture')
expect(readmeEn.includes('not Apple Developer ID signed or notarized'), 'English README discloses macOS signing status')
expect(readmeEn.includes('no Authenticode signature'), 'English README discloses Windows signing status')
expect(readmeEn.includes('System Settings → Privacy & Security'), 'English README prefers the supported macOS opening flow')
expect(readmeZh.includes('“系统设置”→“隐私与安全”'), 'Chinese README prefers the supported macOS opening flow')
for (const readme of [readmeEn, readmeZh]) {
  expect(readme.includes('xattr -dr com.apple.quarantine "/Applications/Nomi.app"'), 'README damaged-app recovery uses the scoped quarantine command')
  expect(!readme.includes('spctl --master-disable'), 'README never disables Gatekeeper globally')
  // README 链仓库里同一个片子文件：合并即可看，不依赖官网部署。
  expect(readme.includes('https://github.com/aqm857886159/Nomi/blob/main/marketing/assets/video/nomi-0.22-film.mp4'), 'README links the 0.22 film hosted in this repository')
  for (const image of readme.matchAll(/(?:src|srcset)="(marketing\/assets\/[^"]+)"|\]\((marketing\/assets\/[^)]+)\)/g)) {
    const relative = image[1] ?? image[2]
    expect(fs.existsSync(path.join(root, relative)), `README image ${relative} exists`)
  }
}
expect(
  readmeEn.includes('Linux, Windows arm64, and macOS universal installers are not currently published'),
  'English README scopes supported release targets',
)
expectCommunityConversion(readmeEn, '## Community', '\n## ', 'English README')
expectCommunityConversion(readmeZh, '## 社区', '\n## ', 'Chinese README')
expectBefore(readmeEn, '## Download', '## Community', 'English README puts downloads before the community QR codes')
expectBefore(readmeZh, '## 下载', '## 社区', 'Chinese README puts downloads before the community QR codes')

console.log('MARKETING HOME STATIC PASS')
