import { contentByLocale, shared as siteShared } from './content.mjs'

const localizedImage = {
  'zh-CN': '/assets/social-preview-zh.jpg',
  en: '/assets/social-preview-en.jpg',
}

/** 每页的 hreflang：中英互指，x-default 指中文那一版。页面 <head> 与 sitemap 都读这一份。 */
export const alternateLinks = (alternates) => [
  { lang: 'zh-CN', path: alternates['zh-CN'] },
  { lang: 'en', path: alternates.en },
  { lang: 'x-default', path: alternates['zh-CN'] },
]

/**
 * 一个公开页面的 SEO / 分享 / 结构化数据。
 * page = { path, htmlLang, ogLocale, meta, alternates: { 'zh-CN': path, en: path }, breadcrumbs?, graph?, image? }——
 * 每页都有一对中英互为 hreflang 的地址，x-default 指中文那一版。
 * `breadcrumbs` 是 [{ name, path }]（最后一项就是本页）；`graph` 是本页独有的结构化数据节点
 * （库首页的 ItemList、配方的 CreativeWork、技能的 SoftwareSourceCode）——只写页面上真有的东西。
 */
export function buildMetadata(locale, page, shared) {
  const canonical = `${shared.siteUrl}${page.path}`
  const image = page.image ? `${shared.siteUrl}${page.image}` : `${shared.siteUrl}${localizedImage[locale]}`

  const websiteId = `${shared.siteUrl}/#website`
  const applicationId = `${shared.siteUrl}/#application`
  const organizationId = `${shared.siteUrl}/#organization`
  const breadcrumbs = page.breadcrumbs?.length
    ? [{
        '@type': 'BreadcrumbList',
        '@id': `${canonical}#breadcrumbs`,
        itemListElement: page.breadcrumbs.map((crumb, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: crumb.name,
          item: `${shared.siteUrl}${crumb.path}`,
        })),
      }]
    : []
  return {
    title: page.meta.title,
    description: page.meta.description,
    canonical,
    alternates: alternateLinks(page.alternates).map(({ lang, path }) => ({ lang, href: `${shared.siteUrl}${path}` })),
    openGraph: {
      locale: page.ogLocale,
      title: page.meta.title,
      description: page.meta.description,
      image,
      imageAlt: page.meta.imageAlt,
    },
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebSite',
          '@id': websiteId,
          name: 'Nomi',
          url: `${shared.siteUrl}/`,
          inLanguage: ['zh-CN', 'en'],
          publisher: { '@id': organizationId },
        },
        // 谁做的、官方账号在哪：搜索引擎和 AI 靠 sameAs 把 GitHub、X 上的 Nomi 认成同一个东西，
        // 不和同名的 nomi.ai 混在一起。只列项目自己的官方地址。
        {
          '@type': 'Organization',
          '@id': organizationId,
          name: 'Nomi',
          url: `${shared.siteUrl}/`,
          logo: `${shared.siteUrl}/assets/nomi-logo.svg`,
          sameAs: [siteShared.repositoryUrl, siteShared.atomgitUrl, siteShared.twitterUrl],
        },
        {
          '@type': page.pageType ?? 'WebPage',
          '@id': canonical,
          url: canonical,
          name: page.meta.title,
          description: page.meta.description,
          inLanguage: page.htmlLang,
          isPartOf: { '@id': websiteId },
          about: { '@id': applicationId },
          primaryImageOfPage: { '@type': 'ImageObject', contentUrl: image },
          ...(breadcrumbs.length ? { breadcrumb: { '@id': `${canonical}#breadcrumbs` } } : {}),
        },
        {
          '@type': 'SoftwareApplication',
          '@id': applicationId,
          name: 'Nomi',
          applicationCategory: 'MultimediaApplication',
          operatingSystem: 'macOS, Windows',
          codeRepository: shared.repositoryUrl,
          license: shared.licenseUrl,
          url: `${shared.siteUrl}/`,
          softwareVersion: shared.version,
          downloadUrl: shared.releaseUrl,
          description: contentByLocale[locale]?.meta.description,
          screenshot: `${shared.siteUrl}/assets/promo-0.22/still-agent.jpg`,
          isAccessibleForFree: true,
          // 软件本身免费；模型费用由用户直接付给供应商，不经过 Nomi。
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
          author: { '@id': organizationId },
          publisher: { '@id': organizationId },
        },
        ...breadcrumbs,
        ...(page.graph ?? []),
      ],
    },
  }
}
