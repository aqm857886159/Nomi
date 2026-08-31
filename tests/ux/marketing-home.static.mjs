import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
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
  const groupImage = conversion.match(/<img src="docs\/media\/nomi-canvas-group-wechat-2026-08-25\.png"[^>]*>/)?.[0]
  expect(groupImage && /width="2\d{2}"/.test(groupImage), `${language} group QR remains prominent on mobile`)
  expect(!conversion.includes('|:---'), `${language} conversion avoids a shrinking Markdown table`)
  expectBefore(
    conversion,
    'docs/media/nomi-canvas-group-wechat-2026-08-25.png',
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
const files = [
  'marketing/assets/video/hero-loop.mp4',
  'marketing/assets/demo.mp4',
  'marketing/assets/video/launch-film-en.mp4',
  'marketing/assets/video/launch-film-zh.vtt',
  'marketing/assets/video/launch-film-en.vtt',
  'marketing/assets/video/hero-poster.jpg',
  'marketing/assets/social-preview-zh.jpg',
  'marketing/assets/social-preview-en.jpg',
  'marketing/assets/screen-agentic.jpg',
  'marketing/assets/group-wechat-2026-08-25.png',
  'marketing/assets/qingyang-wechat.jpg',
  'docs/media/nomi-canvas-group-wechat-2026-08-25.png',
  'docs/media/qingyang-wechat.jpg',
  '.github/ISSUE_TEMPLATE/business_inquiry.yml',
  'README.zh-CN.md',
]

expect(/<html lang="zh-CN">/.test(zh), 'Chinese lang is static')
expect(/<html lang="en">/.test(en), 'English lang is static')
expect(zh.includes('把镜头讲清楚'), 'Chinese Hero claim exists')
expect(en.includes('Direct the shot. Not just the prompt.'), 'English Hero claim exists')
expect(zh.includes('定制开发') && en.includes('Custom builds'), 'paid services are localized')
expect(zh.includes('id="community"'), 'Chinese community section exists')
expect(en.includes('id="community"'), 'English community section exists')
expect(zh.includes('href="#community"') && zh.includes('>社群<'), 'Chinese community nav exists')
expect(en.includes('href="#community"') && en.includes('>Community<'), 'English community nav exists')
expect(zh.includes('/assets/group-wechat-2026-08-25.png'), 'Chinese group QR destination uses a cache-busting version')
expect(zh.includes('/assets/qingyang-wechat.jpg'), 'Chinese maintainer QR destination exists')
expect(zh.includes('TZ857886159'), 'Chinese direct WeChat ID exists')
expect(en.includes('github.com/aqm857886159/Nomi/discussions'), 'English community uses Discussions')
for (const service of ['定制开发', '系统与模型集成', '贴牌交付与商业授权', '持续优化、维护与迭代']) {
  expect(zh.includes(service), `Chinese service survives: ${service}`)
}
for (const service of ['Custom builds', 'System and model integrations', 'White-label and commercial license', 'Ongoing optimization and iteration']) {
  expect(en.includes(service), `English service survives: ${service}`)
}
expect(zh.includes('Nomi MCP') && zh.includes('可编辑初稿'), 'Chinese agentic workflow is explicit')
expect(en.includes('One sentence to an editable first cut') && en.includes('Nomi over MCP'), 'English agentic workflow is explicit')
expect(zh.includes('/assets/nomi-logo.svg') && en.includes('/assets/nomi-logo.svg'), 'official Nomi mark is used')
expect(zh.includes('/en/') && en.includes('href="/"'), 'locale switch is a real link')
expect(zh.includes('rel="canonical" href="https://nomiaqm.com/"'), 'Chinese canonical')
expect(en.includes('rel="canonical" href="https://nomiaqm.com/en/"'), 'English canonical')
for (const html of [zh, en]) {
  expect((html.match(/hreflang=/g) || []).length === 3, 'three hreflang links')
  expect(html.includes('https://www.gnu.org/licenses/agpl-3.0.html'), 'AGPL JSON-LD URL')
  expect(!html.includes('https://www.apache.org/licenses/LICENSE-2.0'), 'no current Apache JSON-LD')
  expect(html.includes('autoplay') && html.includes('muted') && html.includes('playsinline'), 'silent hero attributes')
  expect(html.includes('<dialog') && html.includes('<track kind="captions"'), 'film dialog and captions')
  expect(html.includes('business_inquiry.yml'), 'business CTA destination')
}
for (const rel of files) expect(fs.existsSync(path.join(root, rel)), `${rel} exists`)
expect(
  fs.readFileSync(path.join(root, 'marketing/assets/group-wechat-2026-08-25.png')).equals(
    fs.readFileSync(path.join(root, 'docs/media/nomi-canvas-group-wechat-2026-08-25.png')),
  ),
  'website and README publish the identical group QR',
)
expect(!fs.existsSync(path.join(root, 'marketing/assets/group-wechat.png')), 'legacy immutable group QR asset removed')
expect(!fs.existsSync(path.join(root, 'docs/media/nomi-canvas-group-wechat.png')), 'legacy README group QR asset removed')
expect(!fs.existsSync(path.join(root, 'marketing/assets/demo.gif')), 'legacy demo GIF removed')
expect(!fs.existsSync(path.join(root, 'marketing/assets/vendor/gsap.min.js')), 'GSAP removed')
expect(!fs.existsSync(path.join(root, 'marketing/assets/vendor/ScrollTrigger.min.js')), 'ScrollTrigger removed')
expect(sitemap.includes('<loc>https://nomiaqm.com/en/</loc>'), 'English route in sitemap')
expect((zh.match(/<meta property="og:locale"/g) || []).length === 1, 'one Chinese OG locale')
expect((en.match(/<meta property="og:locale"/g) || []).length === 1, 'one English OG locale')
expect(zh.includes('social-preview-zh.jpg'), 'Chinese social card')
expect(en.includes('social-preview-en.jpg'), 'English social card')
expect(read('README.md').includes('historical releases'), 'English historical-license context')
expect(read('README.zh-CN.md').includes('历史版本'), 'Chinese historical-license context')
expect(headers.includes('/en/index.html'), 'English HTML cache rule')
expect(headers.includes('/assets/video/*') && headers.includes('max-age=3600, must-revalidate'), 'stable media filenames revalidate')
for (const label of ['加入用户群', '团队合作', '夸克网盘镜像', 'TZ857886159']) {
  expect(readmeZh.includes(label), `Chinese README conversion survives: ${label}`)
}
expect(readmeZh.includes('docs/media/nomi-canvas-group-wechat-2026-08-25.png'), 'Chinese README keeps versioned group QR')
expect(readmeZh.includes('docs/media/qingyang-wechat.jpg'), 'Chinese README keeps maintainer QR')
expect(readmeZh.includes('business_inquiry.yml'), 'Chinese README keeps business inquiry')
for (const label of ['Community', 'For Teams', 'Custom builds', 'Integrations', 'White-label / commercial licenses', 'Ongoing iteration']) {
  expect(readmeEn.includes(label), `English README conversion survives: ${label}`)
}
expect(readmeEn.includes('github.com/aqm857886159/Nomi/discussions'), 'English README keeps Discussions')
expect(readmeEn.includes('business_inquiry.yml'), 'English README keeps business inquiry')
const readmeHero = '[![Nomi director workflow]'
const readmeZhHero = '[![Nomi 导演工作流]'
for (const [token, label] of [
  ['<img src="docs/media/nomi-canvas-group-wechat-2026-08-25.png"', 'group QR'],
  ['<img src="docs/media/qingyang-wechat.jpg"', 'maintainer QR'],
  ['TZ857886159', 'textual WeChat fallback'],
]) {
  expectBefore(readmeEn, token, readmeHero, `English default README keeps ${label} before hero`)
  expectBefore(readmeZh, token, readmeZhHero, `Chinese README keeps ${label} before hero`)
}
expectMobileSafeConversion(readmeEn, '## WeChat / 微信联系', readmeHero, 'English default README')
expectMobileSafeConversion(readmeZh, '## 微信联系', readmeZhHero, 'Chinese README')
console.log('MARKETING HOME STATIC PASS')
