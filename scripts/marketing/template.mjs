import { contentByLocale } from './content.mjs'
import { homepageClientJs, localeBootstrapJs } from './client.mjs'
import { downloadUrls } from './downloads.mjs'
import { buildMetadata } from './metadata.mjs'
import { homepageCss } from './styles.mjs'

const escapeText = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')

const escapeAttr = (value) => escapeText(value)
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

const externalAttrs = 'target="_blank" rel="noreferrer"'

function renderMetadata(metadata) {
  const alternates = metadata.alternates
    .map(({ lang, href }) => `<link rel="alternate" hreflang="${escapeAttr(lang)}" href="${escapeAttr(href)}" />`)
    .join('\n')
  const jsonLd = JSON.stringify(metadata.jsonLd).replaceAll('<', '\\u003c')
  return `<title>${escapeText(metadata.title)}</title>
<meta name="description" content="${escapeAttr(metadata.description)}" />
<meta name="robots" content="index,follow,max-image-preview:large" />
<meta name="theme-color" content="#f4f2ec" />
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

function renderNav(content, shared, locale) {
  const localeHref = locale === 'zh-CN' ? '/en/' : '/'
  const localeChoice = locale === 'zh-CN' ? 'en' : 'zh-CN'
  return `<header class="site-header">
  <nav class="nav" aria-label="${escapeAttr(content.nav.ariaLabel)}">
    <a class="brand" href="${escapeAttr(content.path)}" aria-label="Nomi">
      <img src="/assets/nomi-logo.svg" width="30" height="30" alt="" />
      <span>Nomi</span>
    </a>
    <div class="nav-links" id="nav-links">
      <a href="#cost">${escapeText(content.nav.why)}</a>
      <a href="#workflow">${escapeText(content.nav.workflow)}</a>
      <a href="#open">${escapeText(content.nav.open)}</a>
      <a href="#start">${escapeText(content.nav.manual)}</a>
      <a href="#community">${escapeText(content.nav.community)}</a>
    </div>
    <div class="nav-actions">
      <a class="locale" href="${localeHref}" data-locale-choice="${localeChoice}" aria-label="${escapeAttr(content.nav.localeLabel)}">${escapeText(content.nav.locale)}</a>
      <a class="button primary nav-download" data-download-nomi href="#download-options">${escapeText(content.nav.download)}</a>
      <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="nav-links">${escapeText(content.nav.menu)}</button>
    </div>
  </nav>
</header>`
}

function renderHero(content, shared) {
  const ribbons = content.hero.ribbon.map((item) => `<span>${escapeText(item)}</span>`).join('')
  return `<section class="hero" id="top">
  <div class="wrap hero-copy" data-reveal>
    <p class="eyebrow">${escapeText(content.hero.eyebrow)}</p>
    <h1><span class="line">${escapeText(content.hero.titleLead)}</span><span class="line hit">${escapeText(content.hero.titleEmphasis)}</span></h1>
    <p class="hero-lede">${escapeText(content.hero.lede)}</p>
    <div class="hero-actions">
      <a class="button primary" data-download-nomi href="#download-options">${escapeText(content.hero.download)}</a>
      <a class="button" href="${content.htmlLang === 'en' ? '/assets/video/launch-film-en.mp4' : '/assets/demo.mp4'}" data-open-dialog="launch-film">${escapeText(content.hero.watch)}</a>
    </div>
    <p class="mac-download-note">${escapeText(content.hero.macNotice)} <a href="#download-options" data-open-dialog="download-dialog">${escapeText(content.hero.macInstallHelp)}</a></p>
    <p class="truth-note">${escapeText(content.hero.truth)}</p>
  </div>
  <figure class="hero-product">
    <div class="cost-ribbon" aria-hidden="true">${ribbons}</div>
    <div class="product-shot"><img src="/assets/screen-canvas-2026-08-17.png" alt="${escapeAttr(content.hero.imageAlt)}" width="3200" height="1722" /></div>
  </figure>
</section>`
}

function renderCost(content) {
  const initial = content.cost.items[0]
  const tabs = content.cost.items.map((item, index) => `<button id="cost-tab-${escapeAttr(item.id)}" class="cost-tab" type="button" role="tab" aria-selected="${index === 0}" aria-controls="cost-panel" tabindex="${index === 0 ? '0' : '-1'}" data-cost="${escapeAttr(item.id)}">${escapeText(item.label)}</button>`).join('')
  return `<section class="cost-section" id="cost">
  <div class="wrap">
    <div class="cost-heading" data-reveal>
      <div><p class="eyebrow">${escapeText(content.cost.eyebrow)}</p><h2>${escapeText(content.cost.title)}</h2></div>
      <p>${escapeText(content.cost.description)}</p>
    </div>
    <div class="cost-tabs" role="tablist" aria-label="${escapeAttr(content.cost.tabsLabel)}" data-reveal>${tabs}</div>
    <div class="cost-panel" id="cost-panel" role="tabpanel" aria-labelledby="cost-tab-${escapeAttr(initial.id)}" aria-live="polite" data-reveal>
      <div class="cost-panel-copy">
        <div><div class="cost-index" id="cost-index">${escapeText(initial.index)}</div><h3 id="cost-title">${escapeText(initial.title)}</h3><p id="cost-copy">${escapeText(initial.description)}</p></div>
        <div class="cost-proof" id="cost-proof">${escapeText(initial.proof)}</div>
      </div>
      <div class="cost-evidence"><img id="cost-image" src="${escapeAttr(initial.image)}" alt="${escapeAttr(initial.imageAlt)}" width="3200" height="1722" /></div>
    </div>
  </div>
</section>`
}

function renderStack(content) {
  const rows = content.stack.rows.map((row) => `<div class="stack-row">
    <div class="stack-label">${escapeText(row.label)}</div>
    <div class="stack-items">${row.items.map((item) => `<span>${escapeText(item)}</span>`).join('')}</div>
    <div class="stack-arrow" aria-hidden="true">→</div>
    <div class="stack-result">${escapeText(row.result)}</div>
  </div>`).join('')
  return `<section class="stack" aria-labelledby="stack-title">
  <div class="wrap">
    <div class="stack-head" data-reveal>
      <p class="eyebrow">${escapeText(content.stack.eyebrow)}</p>
      <h2 id="stack-title">${escapeText(content.stack.titleLead)}<br />${escapeText(content.stack.titleEmphasis)}</h2>
      <p>${escapeText(content.stack.description)}</p>
    </div>
    <div class="stack-map" data-reveal>${rows}</div>
  </div>
</section>`
}

function renderWorkflow(content) {
  const initial = content.workflow.steps[0]
  const tabs = content.workflow.steps.map((step, index) => `<button id="workflow-tab-${escapeAttr(step.id)}" class="workflow-tab" type="button" role="tab" aria-selected="${index === 0}" aria-controls="workflow-panel" tabindex="${index === 0 ? '0' : '-1'}" data-step="${escapeAttr(step.id)}"><span>${escapeText(step.number)}</span><strong>${escapeText(step.label)}</strong></button>`).join('')
  return `<section class="workflow" id="workflow">
  <div class="wrap">
    <p class="eyebrow" data-reveal>${escapeText(content.workflow.eyebrow)}</p>
    <h2 data-reveal>${escapeText(content.workflow.title)}</h2>
    <div class="workflow-grid" data-reveal>
      <div class="workflow-tabs" role="tablist" aria-label="${escapeAttr(content.workflow.tabsLabel)}">${tabs}</div>
      <div class="workflow-visual" id="workflow-panel" role="tabpanel" aria-labelledby="workflow-tab-${escapeAttr(initial.id)}" aria-live="polite">
        <div class="workflow-image-frame"><img id="workflow-image" src="${escapeAttr(initial.image)}" alt="${escapeAttr(initial.imageAlt)}" width="3200" height="1722" /></div>
        <p class="workflow-caption" id="workflow-caption">${escapeText(initial.caption)}</p>
      </div>
    </div>
  </div>
</section>`
}

function renderAgent(content) {
  const bullets = content.agent.bullets.map((item) => `<li>${escapeText(item)}</li>`).join('')
  return `<section class="agent-band" aria-labelledby="agent-title">
  <div class="agent-grid">
    <div class="agent-copy" data-reveal>
      <p class="eyebrow">${escapeText(content.agent.eyebrow)}</p>
      <h2 id="agent-title">${escapeText(content.agent.titleLead)}<br />${escapeText(content.agent.titleEmphasis)}</h2>
      <p>${escapeText(content.agent.description)}</p>
      <ul class="agent-list">${bullets}</ul>
    </div>
    <div class="agent-image" data-reveal><img src="/assets/screen-agentic-2026-08-17.png" alt="${escapeAttr(content.agent.imageAlt)}" width="3200" height="1722" /></div>
  </div>
</section>`
}

function renderOpenSource(content, shared) {
  const facts = content.openSource.facts.map((fact) => `<div class="open-fact"><span>${escapeText(fact.label)}</span><span>${escapeText(fact.value)}</span></div>`).join('')
  return `<section class="open-source" id="open">
  <div class="wrap open-grid">
    <div data-reveal>
      <p class="eyebrow">${escapeText(content.openSource.eyebrow)}</p>
      <h2>${escapeText(content.openSource.title)}</h2>
      <div class="open-actions">
        <a class="button primary" href="${escapeAttr(shared.repositoryUrl)}" ${externalAttrs}>${escapeText(content.openSource.github)}</a>
        <a class="button" href="${escapeAttr(shared.licenseUrl)}" ${externalAttrs}>${escapeText(content.openSource.license)}</a>
      </div>
    </div>
    <div class="open-facts" data-reveal>${facts}</div>
  </div>
</section>`
}

function renderStart(content, shared, locale) {
  const steps = content.start.steps.map((step) => `<div class="start-row"><span class="start-number">${escapeText(step.number)}</span><h3>${escapeText(step.title)}</h3><p>${escapeText(step.description)}</p></div>`).join('')
  const quickstartHref = locale === 'en' ? `${shared.repositoryUrl}#quick-start` : shared.quickstartUrl
  return `<section class="start" id="start">
  <div class="wrap">
    <p class="eyebrow" data-reveal>${escapeText(content.start.eyebrow)}</p>
    <h2 data-reveal>${escapeText(content.start.title)}</h2>
    <div class="start-grid" data-reveal>${steps}</div>
    <div class="manual-links" data-reveal>
      <a class="button primary" href="${escapeAttr(quickstartHref)}">${escapeText(content.start.quickstart)}</a>
      <a class="button" href="${escapeAttr(shared.handbookUrl)}">${escapeText(content.start.handbook)}</a>
      <a class="button" href="${escapeAttr(shared.mcpGuideUrl)}" ${externalAttrs}>${escapeText(content.start.mcpGuide)}</a>
    </div>
  </div>
</section>`
}

function renderCommunity(content, shared) {
  return `<section class="community" id="community">
  <div class="wrap">
    <div class="community-head" data-reveal>
      <p class="eyebrow">${escapeText(content.community.eyebrow)}</p>
      <h2>${escapeText(content.community.title)}</h2>
      <p>${escapeText(content.community.description)}</p>
    </div>
    <div class="community-grid">
      <article class="community-card user-community" data-reveal>
        <div class="community-copy">
          <div><p class="eyebrow">${escapeText(content.community.group.eyebrow)}</p><h3>${escapeText(content.community.group.title)}</h3><p>${escapeText(content.community.group.description)}</p></div>
          <div class="card-actions"><a class="button" href="${escapeAttr(shared.discussionUrl)}" ${externalAttrs}>${escapeText(content.community.group.discussion)}</a></div>
        </div>
        <figure class="community-qr" id="community-qr"><img src="${escapeAttr(shared.groupQr)}" alt="${escapeAttr(content.community.group.qrAlt)}" width="140" height="210" /><figcaption>${escapeText(content.community.group.qrCaption)}</figcaption></figure>
      </article>
      <article class="community-card dark" data-reveal>
        <div><p class="eyebrow">${escapeText(content.community.project.eyebrow)}</p><h3>${escapeText(content.community.project.title)}</h3><p>${escapeText(content.community.project.description)}</p></div>
        <div class="card-actions">
          <button class="button light" type="button" data-open-dialog="author-dialog">${escapeText(content.community.project.wechat)}</button>
          <a class="button coral" href="${escapeAttr(shared.businessUrl)}" ${externalAttrs}>${escapeText(content.community.project.submit)}</a>
        </div>
      </article>
    </div>
  </div>
</section>`
}

function renderClosing(content, shared, locale) {
  const localeHref = locale === 'zh-CN' ? '/en/' : '/'
  const localeChoice = locale === 'zh-CN' ? 'en' : 'zh-CN'
  return `<section class="closing">
  <div class="wrap">
    <p class="eyebrow" data-reveal>${escapeText(content.closing.eyebrow)}</p>
    <h2 data-reveal>${escapeText(content.closing.title)}</h2>
    <p data-reveal>${escapeText(content.closing.description)}</p>
    <div class="hero-actions" data-reveal>
      <a class="button light" data-download-nomi href="#download-options">${escapeText(content.closing.download)}</a>
      <a class="button coral" href="#community-qr">${escapeText(content.closing.community)}</a>
    </div>
    <footer class="footer">
      <span>${escapeText(content.footer.product)} · <a href="${escapeAttr(shared.licenseUrl)}" ${externalAttrs}>${escapeText(shared.licenseName)}</a></span>
      <span>${escapeText(content.footer.truth)}</span>
      <a href="${localeHref}" data-locale-choice="${localeChoice}">${escapeText(content.footer.locale)}</a>
    </footer>
  </div>
</section>`
}

function renderDownloadOptions(content) {
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

function renderDialogs(content, shared) {
  const isEnglish = content.htmlLang === 'en'
  const filmSource = isEnglish ? '/assets/video/launch-film-en.mp4' : '/assets/demo.mp4'
  const trackSource = isEnglish ? '/assets/video/launch-film-en.vtt' : '/assets/video/launch-film-zh.vtt'
  const trackLang = isEnglish ? 'en' : 'zh-CN'
  const trackLabel = isEnglish ? 'English' : '简体中文'
  return `<dialog id="launch-film" aria-labelledby="film-title">
  <div class="dialog-head"><strong id="film-title">${escapeText(content.a11y.filmTitle)}</strong><button class="dialog-close" type="button" aria-label="${escapeAttr(content.a11y.close)}">×</button></div>
  <div class="dialog-body"><video controls preload="metadata" poster="/assets/video/hero-poster.jpg"><source src="${filmSource}" type="video/mp4" /><track kind="captions" srclang="${trackLang}" src="${trackSource}" label="${trackLabel}" default /></video></div>
</dialog>
<dialog id="author-dialog" aria-labelledby="author-title">
  <div class="dialog-head"><strong id="author-title">${escapeText(content.a11y.authorTitle)}</strong><button class="dialog-close" type="button" aria-label="${escapeAttr(content.a11y.close)}">×</button></div>
  <div class="dialog-body qr-content"><img src="${escapeAttr(shared.authorQr)}" alt="${escapeAttr(content.a11y.authorTitle)}" width="960" height="960" /><p>${escapeText(content.a11y.authorCopy)}</p></div>
</dialog>
<dialog id="download-dialog" aria-labelledby="download-title">
  <div class="dialog-head"><strong id="download-title">${escapeText(content.download.title)}</strong><button class="dialog-close" type="button" aria-label="${escapeAttr(content.a11y.close)}">×</button></div>
  <div class="dialog-body download-dialog-body"><p>${escapeText(content.download.description)}</p><div class="download-options">${renderDownloadOptions(content)}</div>${renderMacInstallGuide(content)}</div>
</dialog>`
}

function renderNoScriptDownload(content) {
  return `<noscript><section class="download-fallback" id="download-options"><div class="wrap"><h2>${escapeText(content.download.title)}</h2><p>${escapeText(content.download.description)}</p><div class="download-options">${renderDownloadOptions(content)}</div>${renderMacInstallGuide(content)}</div></section></noscript>`
}

export function renderHomepage(locale, runtimeFacts) {
  const content = contentByLocale[locale]
  if (!content) throw new Error(`Unknown marketing locale: ${locale}`)
  const metadata = buildMetadata(locale, content, runtimeFacts)
  const interactionData = { cost: content.cost.items, workflow: content.workflow.steps }
  return `<!doctype html>
<html lang="${escapeAttr(content.htmlLang)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
${renderMetadata(metadata)}
<script>${localeBootstrapJs()}</script>
<link rel="icon" type="image/svg+xml" href="/assets/nomi-logo.svg" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Noto+Sans+SC:wght@400;500;600;700;900&display=swap" />
<style>${homepageCss}</style>
</head>
<body>
<a class="skip-link" href="#main">${escapeText(content.a11y.skip)}</a>
${renderNav(content, runtimeFacts, locale)}
<main id="main">
${renderHero(content, runtimeFacts)}
${renderCost(content)}
${renderStack(content)}
${renderWorkflow(content)}
${renderAgent(content)}
${renderOpenSource(content, runtimeFacts)}
${renderStart(content, runtimeFacts, locale)}
${renderCommunity(content, runtimeFacts)}
${renderClosing(content, runtimeFacts, locale)}
</main>
${renderDialogs(content, runtimeFacts)}
${renderNoScriptDownload(content)}
<script>${homepageClientJs(downloadUrls, interactionData)}</script>
</body>
</html>
`
}
