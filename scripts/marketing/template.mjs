import { contentByLocale } from './content.mjs'
import { buildMetadata } from './metadata.mjs'
import { escapeAttr, escapeText, externalAttrs, localizedPath, otherLocale, renderDocument, renderDownloadOptions } from './shell.mjs'
import { pageCss } from './styles.mjs'

/** 某个页面在某种语言下的地址：唯一来源是 content.mjs 里的 path（hreflang 互指、语言切换都从这里读）。 */
const pagePath = (pageKey, locale) => (pageKey === 'home' ? contentByLocale[locale].path : contentByLocale[locale].quickstart.path)

function renderHero(content, shared) {
  const poster = content.htmlLang === 'en' ? shared.filmPosterEn : shared.filmPoster
  return `<section class="hero" id="top">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="eyebrow">${escapeText(content.hero.eyebrow)}</p>
      <h1 class="display"><span>${escapeText(content.hero.titleLead)}</span> <em>${escapeText(content.hero.titleEmphasis)}</em></h1>
      <p class="lede">${escapeText(content.hero.lede)}</p>
      <div class="hero-actions">
        <a class="button primary" data-download-nomi href="#download-options">${escapeText(content.hero.download)}</a>
        <a class="button quiet" data-github-hero href="${escapeAttr(shared.repositoryUrl)}" ${externalAttrs}>${escapeText(content.hero.github)}</a>
      </div>
      <p class="hero-meta">${escapeText(content.hero.meta)}</p>
      <p class="mac-download-note">${escapeText(content.hero.macNotice)} <a href="#download-options" data-open-dialog="download-dialog">${escapeText(content.hero.macInstallHelp)}</a></p>
    </div>
    <figure class="window" id="film">
      <div class="window-bar" aria-hidden="true"><i></i><i></i><i></i><span>${escapeText(content.hero.windowTitle)}</span></div>
      <div class="film"><video class="film-video" data-film src="${escapeAttr(shared.film)}" poster="${escapeAttr(poster)}" controls preload="none" playsinline aria-label="${escapeAttr(content.hero.posterAlt)}"></video><button class="film-play" type="button" data-film-play hidden><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5v11l9-5.5z" fill="currentColor" /></svg>${escapeText(content.hero.play)}</button></div>
    </figure>
  </div>
</section>`
}

function renderPrice(content) {
  const facts = content.price.facts.map((fact) => `<div class="fact"><h3>${escapeText(fact.title)}</h3><p>${escapeText(fact.description)}</p></div>`).join('')
  return `<section class="block" id="price" aria-labelledby="price-title">
  <div class="wrap">
    <div class="block-head">
      <p class="eyebrow">${escapeText(content.price.eyebrow)}</p>
      <h2 id="price-title">${escapeText(content.price.title)}</h2>
      <p class="body">${escapeText(content.price.description)}</p>
    </div>
    <div class="gap-card" role="img" aria-label="${escapeAttr(content.price.barsLabel)}">
      <div class="bar-row"><div class="bar-label">${escapeText(content.price.barCommercial)}</div><div class="bar commercial"></div></div>
      <div class="bar-row"><div class="bar-label">${escapeText(content.price.barYours)}</div><div class="bar yours"></div></div>
      <p class="gap-note">${escapeText(content.price.note)}</p>
    </div>
    <div class="facts">${facts}</div>
  </div>
</section>`
}

function renderFeatures(content, shared) {
  const items = content.features.items.map((item, index) => {
    const time = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
    return `<article class="feature${index % 2 ? ' flip' : ''}" data-feature="${escapeAttr(item.id)}">
      <div class="feature-text">
        <p class="kicker">${escapeText(item.kicker)}</p>
        <h3>${escapeText(item.title)}</h3>
        <p>${escapeText(item.description)}</p>
      </div>
      <div class="node">
        <p class="node-title">${escapeText(item.nodeTitle)}</p>
        <div class="node-frame">
          <video class="segment" data-segment data-start="${item.start}" data-end="${item.end}" src="${escapeAttr(`${shared.film}#t=${item.start},${item.end}`)}" poster="${escapeAttr(item.still)}" muted playsinline preload="none" aria-label="${escapeAttr(item.stillAlt)}"></video>
          <span class="segment-time">${time(item.start)}–${time(item.end)}</span>
        </div>
      </div>
    </article>`
  }).join('\n')
  return `<section class="block" id="features" aria-labelledby="features-title">
  <div class="wrap">
    <div class="block-head">
      <p class="eyebrow">${escapeText(content.features.eyebrow)}</p>
      <h2 id="features-title">${escapeText(content.features.title)}</h2>
    </div>
    ${items}
  </div>
</section>`
}

function renderOpen(content, shared) {
  const tree = content.open.tree.map((row, index) => `<div><span${index === 0 ? ' class="root"' : ''}>${escapeText(row.path)}</span>${row.note ? `<span class="note">${escapeText(row.note)}</span>` : ''}</div>`).join('')
  const points = content.open.points.map((point) => `<li>${escapeText(point)}</li>`).join('')
  return `<section class="block" id="open" aria-labelledby="open-title">
  <div class="wrap">
    <div class="block-head">
      <p class="eyebrow">${escapeText(content.open.eyebrow)}</p>
      <h2 id="open-title">${escapeText(content.open.title)}</h2>
    </div>
    <div class="open-grid">
      <div class="tree" role="img" aria-label="${escapeAttr(content.open.treeLabel)}">${tree}</div>
      <div>
        <ul class="checks">${points}</ul>
        <div class="open-actions">
          <a class="button quiet" href="${escapeAttr(shared.repositoryUrl)}" ${externalAttrs}>${escapeText(content.open.github)}</a>
          <a class="button quiet" href="${escapeAttr(shared.licenseUrl)}" ${externalAttrs}>${escapeText(content.open.license)}</a>
        </div>
      </div>
    </div>
  </div>
</section>`
}

function renderCommunity(content, shared) {
  const c = content.community
  return `<section class="block" id="community" aria-labelledby="community-title">
  <div class="wrap">
    <div class="vision">
      <div>
        <p class="eyebrow">${escapeText(c.eyebrow)}</p>
        <h2 id="community-title">${escapeText(c.title)}</h2>
        <p class="body">${escapeText(c.description)}</p>
        <div class="hero-actions">
          <a class="button on-dark" href="${escapeAttr(shared.repositoryUrl)}" ${externalAttrs}>GitHub</a>
          <a class="button on-dark" href="${escapeAttr(shared.discussionUrl)}" ${externalAttrs}>${escapeText(c.discussion)}</a>
          <a class="button on-dark" href="${escapeAttr(shared.bilibiliUrl)}" ${externalAttrs}>${escapeText(c.bilibili)}</a>
        </div>
      </div>
      <div class="qr-row">
        <figure class="qr" id="community-qr"><img src="${escapeAttr(shared.groupQr)}" alt="${escapeAttr(c.groupAlt)}" width="140" height="210" /><figcaption>${escapeText(c.groupCaption)}</figcaption></figure>
        <figure class="qr"><img src="${escapeAttr(shared.authorQr)}" alt="${escapeAttr(c.authorAlt)}" width="140" height="140" /><figcaption>${escapeText(c.authorCaption)}</figcaption></figure>
      </div>
    </div>
    <div class="teams">
      <div><h3>${escapeText(c.teamsTitle)}</h3><p>${escapeText(c.teamsDescription)}</p></div>
      <div class="hero-actions">
        <button class="button quiet" type="button" data-open-dialog="author-dialog">${escapeText(c.wechat)}</button>
        <a class="button quiet" href="${escapeAttr(shared.businessUrl)}" ${externalAttrs}>${escapeText(c.submit)}</a>
      </div>
    </div>
  </div>
</section>`
}

function renderQuickstartMain(content, shared, version) {
  const q = content.quickstart
  const steps = q.steps.map((step) => {
    const aside = step.id === 'install'
      ? `<div><p class="latest"><span data-latest-version>v${escapeText(version)}</span></p><div class="download-options">${renderDownloadOptions(content)}</div><p class="tip">${escapeText(q.installTip)}</p></div>`
      : `<div class="shot"><img src="${escapeAttr(step.image)}" alt="${escapeAttr(step.imageAlt)}" width="1920" height="1080" /></div>`
    return `<li class="step" id="step-${escapeAttr(step.id)}">
      <div>
        <p class="step-label">${escapeText(step.label)}</p>
        <h2>${escapeText(step.title)}</h2>
        <p>${escapeText(step.description)}</p>
      </div>
      ${aside}
    </li>`
  }).join('\n')
  const faq = q.faq.map((item) => `<details><summary>${escapeText(item.question)}</summary><p>${escapeText(item.answer)}</p></details>`).join('')
  const locale = content.htmlLang
  // 「我想做 X」与「卡住了」是原一页手册里最有用的两块（2026-09-28 并进来，手册页跳转到这里）。
  const routes = q.routes.map((route) => `<article class="route" id="route-${escapeAttr(route.id)}">
      <h3>${escapeText(route.title)}</h3>
      <p>${escapeText(route.body)}</p>
      ${route.link ? `<a href="${escapeAttr(localizedPath(locale, route.link))}">${escapeText(route.linkLabel)} →</a>` : ''}
    </article>`).join('\n')
  const gotchas = q.gotchas.map((item) => `<details id="stuck-${escapeAttr(item.id)}"><summary>${escapeText(item.title)}</summary><p>${escapeText(item.body)}</p></details>`).join('')
  const next = q.next.map((item) => `<a class="button quiet" href="${escapeAttr(localizedPath(locale, item.path))}">${escapeText(item.label)}</a>`).join('')
  return `<section class="qs-hero">
  <div class="wrap">
    <p class="eyebrow">${escapeText(q.eyebrow)}</p>
    <h1 class="display"><span>${escapeText(q.titleLead)}</span> <em>${escapeText(q.titleEmphasis)}</em></h1>
    <p class="lede">${escapeText(q.lede)}</p>
  </div>
</section>
<section class="block qs-steps">
  <div class="wrap">
    <ol class="steps">${steps}</ol>
    <div class="block-head faq-head" id="routes"><h2>${escapeText(q.routesTitle)}</h2></div>
    <div class="routes">${routes}</div>
    <div class="block-head faq-head" id="stuck"><h2>${escapeText(q.gotchasTitle)}</h2></div>
    <div class="faq">${gotchas}</div>
    <div class="block-head faq-head"><h2>${escapeText(q.faqTitle)}</h2></div>
    <div class="faq">${faq}</div>
    <div class="block-head faq-head"><h2>${escapeText(q.nextTitle)}</h2></div>
    <div class="next-links">${next}<a class="button quiet" href="${escapeAttr(shared.mcpGuideUrl)}" ${externalAttrs}>${escapeText(q.mcpGuide)} ↗</a></div>
  </div>
</section>`
}

const faqGraph = (faq, canonical) => ({
  '@type': 'FAQPage',
  '@id': `${canonical}#faq`,
  mainEntity: faq.map((item) => ({
    '@type': 'Question',
    name: item.question,
    acceptedAnswer: { '@type': 'Answer', text: item.answer },
  })),
})

function renderPage(locale, runtimeFacts, pageKey) {
  const content = contentByLocale[locale]
  if (!content) throw new Error(`Unknown marketing locale: ${locale}`)
  const page = {
    path: pagePath(pageKey, locale),
    htmlLang: content.htmlLang,
    ogLocale: content.ogLocale,
    meta: pageKey === 'home' ? content.meta : content.quickstart.meta,
    alternates: { 'zh-CN': pagePath(pageKey, 'zh-CN'), en: pagePath(pageKey, 'en') },
    // 快速上手页上看得见的「常见问题」，原样标成 FAQPage，方便搜索和 AI 按一问一答引用。
    graph: pageKey === 'quickstart' ? [faqGraph(content.quickstart.faq, `${runtimeFacts.siteUrl}${pagePath(pageKey, locale)}`)] : [],
  }
  const main = pageKey === 'home'
    ? [renderHero(content, runtimeFacts), renderPrice(content), renderFeatures(content, runtimeFacts), renderOpen(content, runtimeFacts), renderCommunity(content, runtimeFacts)].join('\n')
    : renderQuickstartMain(content, runtimeFacts, runtimeFacts.version)
  return renderDocument({
    locale,
    pageKey,
    runtimeFacts,
    metadata: buildMetadata(locale, page, runtimeFacts),
    css: pageCss(pageKey),
    main,
    alternateHref: pagePath(pageKey, otherLocale(locale)),
    home: pageKey === 'home',
  })
}

export function renderHomepage(locale, runtimeFacts) {
  return renderPage(locale, runtimeFacts, 'home')
}

export function renderQuickstart(locale, runtimeFacts) {
  return renderPage(locale, runtimeFacts, 'quickstart')
}
