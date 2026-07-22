import { cloneBuiltinCategories, type ProjectCategory } from '../project/projectCategories'
import { getAppLocale } from '../../i18n'

export type ProjectTemplateId = 'manga-short' | 'product-demo' | 'free-form'

export type ProjectTemplate = {
  id: ProjectTemplateId
  name: string
  description: string
  enabledCategories: string[]
  seedDocument: string
  /** Suggested first-active category when the project opens. */
  defaultCategoryId: string
}

export const PROJECT_TEMPLATES: Record<ProjectTemplateId, ProjectTemplate> = {
  'manga-short': {
    id: 'manga-short',
    name: 'AI 漫剧短片',
    description: '5 分钟二次元短剧，预设分镜 / 角色 / 场景 / 道具 / 声音',
    enabledCategories: ['shots', 'cast', 'scene', 'prop', 'audio'],
    seedDocument: '# 第一幕\n\n@角色 主角 { 简述外观 / 性格 / 目标 }\n\n# 第二幕\n\n# 第三幕\n',
    defaultCategoryId: 'shots',
  },
  'product-demo': {
    id: 'product-demo',
    name: '产品 Demo',
    description: '30-60 秒 SaaS 产品介绍，预设分镜 / 场景 / 道具 / 声音',
    enabledCategories: ['shots', 'scene', 'prop', 'audio'],
    seedDocument: '# 30 秒产品 Demo 脚本\n\n1. 问题（5s）：\n2. 方案（10s）：\n3. 演示（10s）：\n4. CTA（5s）：\n',
    defaultCategoryId: 'shots',
  },
  'free-form': {
    id: 'free-form',
    name: '自由创作',
    description: '5 分类全开，无预设内容',
    enabledCategories: ['shots', 'cast', 'scene', 'prop', 'audio'],
    seedDocument: '',
    defaultCategoryId: 'shots',
  },
}

export const PROJECT_TEMPLATE_LIST: ProjectTemplate[] = [
  PROJECT_TEMPLATES['manga-short'],
  PROJECT_TEMPLATES['product-demo'],
  PROJECT_TEMPLATES['free-form'],
]

const EN_PROJECT_TEMPLATES: Record<ProjectTemplateId, ProjectTemplate> = {
  'manga-short': {
    ...PROJECT_TEMPLATES['manga-short'],
    name: 'AI Animated Short',
    description: 'A five-minute animated short with shot, character, scene, prop, and audio categories.',
    seedDocument:
      '# Act One\n\n@Character Protagonist { appearance / personality / goal }\n\n# Act Two\n\n# Act Three\n',
  },
  'product-demo': {
    ...PROJECT_TEMPLATES['product-demo'],
    name: 'Product Demo',
    description: 'A 30–60 second SaaS introduction with shot, scene, prop, and audio categories.',
    seedDocument:
      '# 30-second Product Demo Script\n\n1. Problem (5s):\n2. Solution (10s):\n3. Demo (10s):\n4. CTA (5s):\n',
  },
  'free-form': {
    ...PROJECT_TEMPLATES['free-form'],
    name: 'Freeform',
    description: 'All five categories enabled with no preset content.',
  },
}

export function getProjectTemplate(id: string | null | undefined): ProjectTemplate {
  const templates = getAppLocale() === 'en' ? EN_PROJECT_TEMPLATES : PROJECT_TEMPLATES
  if (id && (id in templates)) return templates[id as ProjectTemplateId]
  return templates['free-form']
}

/** Builds the categories array for a template: builtins, with non-enabled marked hidden. */
export function buildTemplateCategories(template: ProjectTemplate): ProjectCategory[] {
  const enabled = new Set(template.enabledCategories)
  return cloneBuiltinCategories().map((cat) => ({
    ...cat,
    isHidden: !enabled.has(cat.id),
  }))
}
