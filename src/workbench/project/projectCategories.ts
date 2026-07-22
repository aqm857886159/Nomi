import { z } from 'zod'
import i18n from '../../i18n'

// viewType 系统已删除 (E.2C-13)：5 个分类全部基于同一画布底座，
// 仅节点渲染样式按分类不同。详见 docs/plans/2026-05-25-phase-e2-completion-and-tech-uplift.md §3 决策 4。
// 节点渲染分发改由 NodeRenderKind 处理（见 E.2C-14/15）。

// E.2C-14: NodeRenderKind 系统。
// 每个分类有 defaultNodeRenderKind，新建节点默认走该 kind 的 React 组件。
// 5 个 kind 对应 5 个分类的默认渲染样式；后续可扩展到节点级 override。
export const NODE_RENDER_KINDS = [
  'shot-frame', // 分镜默认：图像 + 内嵌 composer + 编号
  'character-card', // 角色默认：缩略图 + 名字 + 设定
  'scene-card', // 场景默认：环境图 + 名字 + 关联角色
  'prop-card', // 道具默认：道具图 + 名字 + 关联标签
  'audio-strip', // 声音默认：波形 + 时长
] as const

export type NodeRenderKind = (typeof NODE_RENDER_KINDS)[number]

// Tabler 图标名映射，详见 src/workbench/sidebar/categoryIcons.ts
// (categoryIcons 模块按 iconName 字符串查实际组件，避免 zod schema 持久化函数引用)
export type TablerIconName = 'IconLayoutRows' | 'IconUser' | 'IconPhoto' | 'IconBox' | 'IconChartBar' | 'IconTag' // 自定义顶层分类统一用的通用图标

export type ProjectCategory = {
  id: string
  name: string
  /**
   * @deprecated v0.5 残留的 emoji 字段，UI 已改用 iconName + Tabler 渲染。
   * 保留是为了让 zod 解析旧持久化数据不抛；E.2C-16 migration 会清理。
   */
  icon: string
  iconName: TablerIconName
  defaultNodeRenderKind: NodeRenderKind
  color?: string
  order: number
  isBuiltin: boolean
  isHidden?: boolean
}

export const BUILTIN_CATEGORY_IDS = ['shots', 'cast', 'scene', 'prop', 'audio'] as const

export type BuiltinCategoryId = (typeof BUILTIN_CATEGORY_IDS)[number]

export const BUILTIN_CATEGORIES: ProjectCategory[] = [
  {
    id: 'shots',
    name: '分镜',
    icon: '🎬',
    iconName: 'IconLayoutRows',
    defaultNodeRenderKind: 'shot-frame',
    order: 1,
    isBuiltin: true,
  },
  {
    id: 'cast',
    name: '角色',
    icon: '👥',
    iconName: 'IconUser',
    defaultNodeRenderKind: 'character-card',
    order: 2,
    isBuiltin: true,
  },
  {
    id: 'scene',
    name: '场景',
    icon: '🌍',
    iconName: 'IconPhoto',
    defaultNodeRenderKind: 'scene-card',
    order: 3,
    isBuiltin: true,
  },
  {
    id: 'prop',
    name: '道具',
    icon: '🧰',
    iconName: 'IconBox',
    defaultNodeRenderKind: 'prop-card',
    order: 4,
    isBuiltin: true,
  },
  {
    id: 'audio',
    name: '声音',
    icon: '🎵',
    iconName: 'IconChartBar',
    defaultNodeRenderKind: 'audio-strip',
    order: 5,
    isBuiltin: true,
  },
]

export const DEFAULT_CATEGORY_ID: BuiltinCategoryId = 'shots'
export const FALLBACK_CATEGORY_ID: BuiltinCategoryId = 'shots'

const tablerIconNameSchema = z.enum(['IconLayoutRows', 'IconUser', 'IconPhoto', 'IconBox', 'IconChartBar', 'IconTag'])

/** 自定义顶层分类的默认外观：通用图标 + 通用「分镜帧」节点样式（用户已拍板：通用第一）。 */
export const CUSTOM_CATEGORY_ICON_NAME: TablerIconName = 'IconTag'
export const CUSTOM_CATEGORY_RENDER_KIND: NodeRenderKind = 'shot-frame'

/** 生成不与现有 id 冲突的自定义分类 id。 */
export function createCustomCategoryId(existingIds: readonly string[]): string {
  const taken = new Set(existingIds)
  let n = existingIds.length + 1
  let id = `cat-${n}`
  while (taken.has(id)) {
    n += 1
    id = `cat-${n}`
  }
  return id
}

/** 按名称 + 排序号造一个自定义顶层分类（通用外观）。 */
export function createCustomCategory(input: { id: string; name: string; order: number }): ProjectCategory {
  return {
    id: input.id,
    name: input.name.trim() || i18n.t('runtime.project.newGroup'),
    icon: '',
    iconName: CUSTOM_CATEGORY_ICON_NAME,
    defaultNodeRenderKind: CUSTOM_CATEGORY_RENDER_KIND,
    order: input.order,
    isBuiltin: false,
  }
}

export const projectCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  icon: z.string().default(''),
  iconName: tablerIconNameSchema,
  defaultNodeRenderKind: z.enum(NODE_RENDER_KINDS),
  color: z.string().optional(),
  order: z.number().finite(),
  isBuiltin: z.boolean(),
  isHidden: z.boolean().optional(),
})

export function getBuiltinCategoryById(id: string): ProjectCategory | null {
  return BUILTIN_CATEGORIES.find((cat) => cat.id === id) || null
}

export function isBuiltinCategoryId(id: string): id is BuiltinCategoryId {
  return (BUILTIN_CATEGORY_IDS as readonly string[]).includes(id)
}

export function cloneBuiltinCategories(): ProjectCategory[] {
  return BUILTIN_CATEGORIES.map((cat) => ({ ...cat }))
}

export function normalizeCategories(input: unknown): ProjectCategory[] {
  if (!Array.isArray(input)) return cloneBuiltinCategories()
  const merged = new Map<string, ProjectCategory>()
  for (const cat of cloneBuiltinCategories()) merged.set(cat.id, cat)
  for (const item of input) {
    const parsed = projectCategorySchema.safeParse(item)
    if (!parsed.success) continue
    // 自定义顶层分类（非内置 id）一并保留；isBuiltin 标志强制与 id 真相对齐，
    // 防止持久化数据把自定义分类伪装成「内置只读」或反之。
    merged.set(parsed.data.id, { ...parsed.data, isBuiltin: isBuiltinCategoryId(parsed.data.id) })
  }
  return Array.from(merged.values()).sort((a, b) => a.order - b.order)
}
