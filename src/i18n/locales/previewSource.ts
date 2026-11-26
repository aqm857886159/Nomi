export const zhPreviewSource = {
  aria: '素材来源',
  collapse: '收起',
  railLabel: '片库',
  expand: '展开素材来源',
  tabs: {
    shots: '镜头',
    assets: '素材',
  },
  shots: {
    emptyTitle: '画布还没有出片的镜头',
    emptyDescription: '去「生成」页生成镜头，这里就能直接拖进成片。',
    itemHint: '{{name}} · 拖到轨道放这里，点击加到片尾',
  },
} as const

type TranslationShape<T> = {
  [K in keyof T]: T[K] extends string ? string : TranslationShape<T[K]>
}

export const enPreviewSource = {
  aria: 'Media sources',
  collapse: 'Collapse',
  railLabel: 'Clips',
  expand: 'Expand media sources',
  tabs: {
    shots: 'Shots',
    assets: 'Assets',
  },
  shots: {
    emptyTitle: 'No finished shots on the canvas yet',
    emptyDescription: 'Generate shots on the Generate page and they show up here.',
    itemHint: '{{name}} · drag onto a track, or click to append',
  },
} satisfies TranslationShape<typeof zhPreviewSource>
