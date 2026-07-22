export const zhFileExplorer = {
  title: '素材',
  listView: '列表视图',
  sort: '排序素材',
  ascending: '升序排列',
  descending: '降序排列',
  refresh: '刷新项目文件',
  import: '导入素材',
  importHint: '把本地文件拷贝进项目素材文件夹',
  importing: '正在导入',
  mediaTypes: '图片、视频、音频',
  openProjectFirst: '打开项目后显示文件',
  reading: '正在读取项目文件…',
  emptyTitle: '还没有文件',
  emptyDescription: '点上方「导入素材」，或把文件拖进来。',
  truncated: '文件较多，已显示前 500 个',
  previewAria: '预览 {{name}}',
  reveal: '在文件夹中打开',
  unsupported: '这种格式暂不支持预览',
  unsupportedHint: '用上方「在文件夹中打开」查看',
  readFailed: '读取失败：{{message}}',
} as const

type TranslationShape<T> = {
  [K in keyof T]: T[K] extends string ? string : TranslationShape<T[K]>
}

export const enFileExplorer = {
  title: 'Assets',
  listView: 'List view',
  sort: 'Sort assets',
  ascending: 'Sort ascending',
  descending: 'Sort descending',
  refresh: 'Refresh project files',
  import: 'Import assets',
  importHint: 'Copy local files into the project asset folder',
  importing: 'Importing',
  mediaTypes: 'Images, video, and audio',
  openProjectFirst: 'Open a project to view its files',
  reading: 'Reading project files…',
  emptyTitle: 'No files yet',
  emptyDescription: 'Use “Import assets” above or drag files here.',
  truncated: 'There are many files. Showing the first 500.',
  previewAria: 'Preview {{name}}',
  reveal: 'Open in folder',
  unsupported: 'Preview is not supported for this format',
  unsupportedHint: 'Use “Open in folder” above to view it',
  readFailed: 'Read failed: {{message}}',
} satisfies TranslationShape<typeof zhFileExplorer>
