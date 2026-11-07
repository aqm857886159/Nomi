// 官网所有页面共用的外壳：<head> 里的 SEO 元数据、顶栏、页脚、下载弹窗与页面脚本。
// 首页、快速上手和三个库、功能介绍都从这里出壳——顶栏只有这一份（2026-09-28 之前首页与快速上手各拼一遍）。
import { homepageClientJs, localeBootstrapJs } from './client.mjs'
import { contentByLocale } from './content.mjs'
import { downloadUrls } from './downloads.mjs'

export const escapeText = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')

export const escapeAttr = (value) => escapeText(value)
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

export const externalAttrs = 'target="_blank" rel="noreferrer"'

export const otherLocale = (locale) => (locale === 'zh-CN' ? 'en' : 'zh-CN')

/** 站内地址按语言加前缀：中文在根，英文在 /en 下（首页是 `/` 与 `/en/`）。 */
export function localizedPath(locale, pathname) {
  if (locale === 'zh-CN') return pathname
  return pathname === '/' ? '/en/' : `/en${pathname}`
}

/** 顶栏：五个去处 + 社区。`pageKey` 决定哪一项高亮。 */
export const NAV_ITEMS = [
  { key: 'features', path: '/features' },
  { key: 'models', path: '/models' },
  { key: 'prompts', path: '/prompts' },
  { key: 'skills', path: '/skills' },
  { key: 'quickstart', path: '/quickstart' },
  { key: 'community', path: '/', hash: 'community' },
]

function renderMetadata(metadata) {
  const alternates = metadata.alternates
    .map(({ lang, href }) => `<link rel="alternate" hreflang="${escapeAttr(lang)}" href="${escapeAttr(href)}" />`)
    .join('\n')
  const jsonLd = JSON.stringify(metadata.jsonLd).replaceAll('<', '\\u003c')
  return `<title>${escapeText(metadata.title)}</title>
<meta name="description" content="${escapeAttr(metadata.description)}" />
<meta name="robots" content="index,follow,max-image-preview:large" />
<meta name="theme-color" content="#faf9f6" />
<link rel="canonical" href="${escapeAttr(metadata.canonical)}" />
${alternates}
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Nomi" />
<meta property="og:locale" content="${escapeAttr(metadata.openGraph.locale)}" />
<meta property="og:title" content="${escapeAttr(metadata.openGraph.title)}" />
<meta property="og:description" content="${escapeAttr(metadata.openGraph.description)}" />
<meta property="og:url" content="${escapeAttr(metadata.canonical)}" />
<meta property="og:image" content="${escapeAttr(metadata.openGraph.image)}" />
<meta property="og:image:alt" content="${escapeAttr(metadata.openGraph.imageAlt)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeAttr(metadata.openGraph.title)}" />
<meta name="twitter:description" content="${escapeAttr(metadata.openGraph.description)}" />
<meta name="twitter:image" content="${escapeAttr(metadata.openGraph.image)}" />
<meta name="twitter:image:alt" content="${escapeAttr(metadata.openGraph.imageAlt)}" />
<script type="application/ld+json">${jsonLd}</script>`
}

function renderNav(content, locale, pageKey, alternateHref) {
  const links = NAV_ITEMS.map(({ key, path, hash }) => {
    const onHome = pageKey === 'home'
    const href = hash ? (onHome ? `#${hash}` : `${localizedPath(locale, path)}#${hash}`) : localizedPath(locale, path)
    const current = key === pageKey ? ' aria-current="page"' : ''
    return `<a href="${escapeAttr(href)}"${current}>${escapeText(content.nav[key])}</a>`
  }).join('\n      ')
  return `<header class="site-header">
  <nav class="nav wrap" aria-label="${escapeAttr(content.nav.ariaLabel)}">
    <a class="brand" href="${escapeAttr(localizedPath(locale, '/'))}" aria-label="Nomi"><img src="/assets/nomi-logo.svg" width="26" height="26" alt="" /><span class="wordmark">No<span>mi</span></span></a>
    <div class="nav-links" id="nav-links">
      ${links}
    </div>
    <div class="nav-actions">
      <a class="locale" href="${escapeAttr(alternateHref)}" data-locale-choice="${otherLocale(locale)}" aria-label="${escapeAttr(content.nav.localeLabel)}">${escapeText(content.nav.locale)}</a>
      <a class="button primary small" data-download-nomi href="#download-options">${escapeText(content.nav.download)}</a>
      <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="nav-links">${escapeText(content.nav.menu)}</button>
    </div>
  </nav>
</header>`
}

function renderFooter(content, shared, locale, alternateHref) {
  const libraries = ['features', 'models', 'prompts', 'skills', 'quickstart']
    .map((key) => `<a href="${escapeAttr(localizedPath(locale, NAV_ITEMS.find((item) => item.key === key).path))}">${escapeText(content.nav[key])}</a>`)
    .join('\n      ')
  return `<footer class="footer">
  <div class="wrap">
    <span class="wordmark small">No<span>mi</span></span>
    <nav class="footer-links" aria-label="${escapeAttr(content.footer.sitemapLabel)}">
      ${libraries}
    </nav>
    <a href="${escapeAttr(shared.repositoryUrl)}" ${externalAttrs}>${escapeText(content.footer.openSource)}</a>
    <a href="${escapeAttr(shared.licenseUrl)}" ${externalAttrs}>${escapeText(content.footer.license)}</a>
    <a href="${escapeAttr(shared.releaseNotesUrl)}" ${externalAttrs}>${escapeText(content.footer.releases)}</a>
    <a href="${escapeAttr(shared.twitterUrl)}" ${externalAttrs}>X / Twitter</a>
    <a href="${escapeAttr(alternateHref)}" data-locale-choice="${otherLocale(locale)}">${escapeText(content.footer.locale)}</a>
    <span class="made">${escapeText(content.footer.made)}</span>
  </div>
</footer>`
}

export function renderDownloadOptions(content) {
  const options = [
    { label: content.download.windows, hint: content.download.windowsHint, href: downloadUrls.windowsX64, code: 'EXE' },
    { label: content.download.macArm, hint: content.download.macArmHint, href: downloadUrls.macArm64, code: 'ARM64' },
    { label: content.download.macIntel, hint: content.download.macIntelHint, href: downloadUrls.macX64, code: 'X64' },
  ]
  return options.map((option) => `<a class="download-option" data-direct-download href="${escapeAttr(option.href)}"><span><strong>${escapeText(option.label)}</strong><small>${escapeText(option.hint)}</small></span><span aria-hidden="true">${option.code} ↓</span></a>`).join('')
}

function renderMacInstallGuide(content) {
  const steps = content.download.macSteps.map((step) => `<li>${escapeText(step)}</li>`).join('')
  return `<section class="mac-install-guide" data-mac-install-guide>
  <strong class="mac-install-guide-title">${escapeText(content.download.macGuideTitle)}</strong>
  <p>${escapeText(content.download.macGuideSummary)}</p>
  <ol>${steps}</ol>
  <p>${escapeText(content.download.macDamaged)}</p>
  <code class="mac-install-command">${escapeText(content.download.macCommand)}</code>
  <p class="mac-install-safety">${escapeText(content.download.macSafety)}</p>
</section>`
}

function renderDialogs(content, shared, withAuthorDialog) {
  // 维护者微信弹窗只有首页有入口（社区一节的按钮）；其余页面只要下载选择弹窗。
  const author = withAuthorDialog ? `<dialog id="author-dialog" aria-labelledby="author-title">
  <div class="dialog-head"><strong id="author-title">${escapeText(content.a11y.authorTitle)}</strong><button class="dialog-close" type="button" aria-label="${escapeAttr(content.a11y.close)}">×</button></div>
  <div class="dialog-body qr-content"><img src="${escapeAttr(shared.authorQr)}" alt="${escapeAttr(content.a11y.authorTitle)}" width="960" height="960" /><p>${escapeText(content.a11y.authorCopy)}</p></div>
</dialog>
` : ''
  return `${author}<dialog id="download-dialog" aria-labelledby="download-title">
  <div class="dialog-head"><strong id="download-title">${escapeText(content.download.title)}</strong><button class="dialog-close" type="button" aria-label="${escapeAttr(content.a11y.close)}">×</button></div>
  <div class="dialog-body download-dialog-body"><p>${escapeText(content.download.description)}</p><div class="download-options">${renderDownloadOptions(content)}</div>${renderMacInstallGuide(content)}</div>
</dialog>`
}

function renderNoScriptDownload(content) {
  return `<noscript><section class="download-fallback" id="download-options"><div class="wrap"><h2>${escapeText(content.download.title)}</h2><p>${escapeText(content.download.description)}</p><div class="download-options">${renderDownloadOptions(content)}</div>${renderMacInstallGuide(content)}</div></section></noscript>`
}

// Tripo 联盟计划（走 impact.com）的站点归属验证：它抓首页 <head> 找这一行，原样照抄、不能改写法。
const IMPACT_SITE_VERIFICATION = `<meta name='impact-site-verification' value='0000cd66-6785-40fa-969f-40fb56143c8d'>`

/**
 * 一整页。`pageKey` 管顶栏高亮与 body class；`alternateHref` 是另一种语言的同一页（语言切换与页脚都用它）。
 * `home` 为真才带首页独有的三样：语言自动跳转脚本、维护者微信弹窗、功能段片段播放。
 */
export function renderDocument({ locale, pageKey, runtimeFacts, metadata, css, main, alternateHref, home = false }) {
  const content = contentByLocale[locale]
  if (!content) throw new Error(`Unknown marketing locale: ${locale}`)
  return `<!doctype html>
<html lang="${escapeAttr(content.htmlLang)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
${renderMetadata(metadata)}
${home ? `${IMPACT_SITE_VERIFICATION}\n` : ''}${home ? `<script>${localeBootstrapJs()}</script>\n` : ''}<link rel="icon" type="image/svg+xml" href="/assets/nomi-logo.svg" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600&family=Noto+Sans+SC:wght@400;500;700;900&display=swap" />
<style>${css}</style>
</head>
<body class="page-${pageKey}">
<a class="skip-link" href="#main">${escapeText(content.a11y.skip)}</a>
${renderNav(content, locale, pageKey, alternateHref)}
<main id="main">
${main}
</main>
${renderFooter(content, runtimeFacts, locale, alternateHref)}
${renderDialogs(content, runtimeFacts, home)}
${renderNoScriptDownload(content)}
<script>${homepageClientJs(downloadUrls, { segments: home })}</script>
</body>
</html>
`
}
