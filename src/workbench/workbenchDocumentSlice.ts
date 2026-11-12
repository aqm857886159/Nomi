import type { StateCreator } from 'zustand'
import i18n from '../i18n'
import { createEmptyStoryboardPlan, isEmptyStoryboardPlan, type StoryboardPlan } from './generationCanvas/agent/storyboardPlan'
import {
  createDefaultWorkbenchDocument,
  mintStoryboardDesignId,
  normalizeWorkbenchDocument,
  type StoryboardDesign,
  type WorkbenchDocument,
} from './workbenchTypes'
import { storyboardDesignIssues } from './storyboardDesignSchema'
import { logRendererWarn } from '../desktop/rendererLog'

/**
 * 存不下的方案**进不了 store**：写入口自己用草稿面（`storyboardDesignSchema`）校验，不过就不写、状态不变、返回 null。
 * 记日志只记字段路径、不记内容。Agent 写口拿同一份校验回「哪个字段、要什么」（`agentStoryboardDesign` / `applyCanvasToolCall`）。
 * 这样「一处不合格让整份项目存不下」的状态在 store 里写不出来，存盘口的逐项隔离只当兜底。
 */
export function designWritable(design: StoryboardDesign, door: string): boolean {
  const issues = storyboardDesignIssues(design)
  if (!issues.length) return true
  logRendererWarn('storyboard-write-rejected', { door, issues: issues.map(issue => issue.path).join('; ') })
  return false
}

/**
 * 谁发起了这次「新建方案」。**这是决定要不要替用户打开它的唯一输入**：
 * 只有用户自己的动作（点「新建方案」、点「复制」）能改变他正在看的那份方案；
 * Agent / 程序新建的东西只进列表，打开是用户的下一个动作（与「程序不挪画布」同一条）。
 * 必须由调用方显式说出来——没有默认值，忘了写编译不过，而不是悄悄替用户切了界面。
 */
export type StoryboardInitiator = 'user' | 'agent'

/**
 * 新建方案之后，「用户正在看的那份」要不要跟着变。**唯一**决定它的地方（`addStoryboardDesign` 与
 * `setStoryboardPlan` 的新建分支共用），不许各调用方自己记得传不传。
 */
function activationAfterCreate(initiator: StoryboardInitiator, documentId: string, designId: string): { activeDocumentId: string; activeStoryboardId: string } | Record<string, never> {
  return initiator === 'user' ? { activeDocumentId: documentId, activeStoryboardId: designId } : {}
}

/** 创作文档 + 分镜方案的状态与 action（P2/P4）。从 workbenchStore 拆出，守 R9/R12 巨壳门。 */
export type WorkbenchDocumentSlice = {
  /** 原稿文档集合（有序，多文档侧栏真相源）。随项目持久化。 */
  workbenchDocuments: WorkbenchDocument[]
  /** 当前激活的原稿文档 id（切换文档 = 切编辑器内容）。随项目持久化。 */
  activeDocumentId: string
  /** 每篇原稿的分镜设计（唯一领域真相源，按 documentId 索引）。随项目持久化。 */
  storyboardDesignsByDocumentId: Record<string, StoryboardDesign[]>
  activeStoryboardId: string | null
  storyboardRowFocus: { designId: string; rowId: string } | null
  setStoryboardRowFocus: (focus: { designId: string; rowId: string } | null) => void
  /** 更新某篇文档（按 id 定位），并 bump 持久化。 */
  setWorkbenchDocument: (document: WorkbenchDocument) => void
  /** 新增一篇原稿（默认空白），返回新文档并设为激活。 */
  addWorkbenchDocument: () => WorkbenchDocument
  /** 删除一篇原稿（不可删到 0 篇，至少保留一篇空稿）。 */
  deleteWorkbenchDocument: (id: string) => void
  /** 改名一篇原稿（空名忽略）。 */
  renameWorkbenchDocument: (id: string, title: string) => void
  /** 切换激活文档（id 不存在则忽略）。 */
  setActiveDocumentId: (id: string) => void
  setActiveStoryboardId: (id: string | null, documentId?: string) => void
  /**
   * 新增一条方案。`identity` 只有 Agent 产出那条路会传：它让方案的 id **就是**模型手里那个
   * draft id，于是「模型指名的那份」与「用户在侧栏看到的那一行」是同一个身份，多轮改的是同一份。
   * 传了 identity 就按模型给的标题原样命名（不追加序号——给「海边日落」加个 2 是胡说）。
   *
   * `initiator` 必填：`'user'` 才会把新方案设为用户正在看的那份，`'agent'` 只入列表。
   */
  addStoryboardDesign: (input: { initiator: StoryboardInitiator; documentId?: string; source?: StoryboardPlan; identity?: { id: string; title: string } }) => StoryboardDesign | null
  /** 复制只会由用户的菜单动作发起，所以复制出来的那份会被打开。 */
  duplicateStoryboardDesign: (id: string, documentId?: string) => StoryboardDesign | null
  renameStoryboardDesign: (id: string, title: string) => void
  deleteStoryboardDesign: (id: string, documentId?: string) => void
  /**
   * 把刚删掉的那条方案放回**原来的位置**（撤销那条路）。
   *
   * 为什么不是「再 add 一条」：`addStoryboardDesign` 会发一个新 id、追加到队尾、
   * 重新起标题。用户点「撤销」要的是「刚才那下没发生」，不是「给我一条长得像的」——
   * 位置变了他就得重新找，id 变了画布上已落的节点绑定就断了。
   *
   * 同名 id 已经在表里就**什么都不做**：撤销只负责撤自己那一笔，绝不覆盖别人后来写的。
   */
  restoreStoryboardDesign: (design: StoryboardDesign, documentId: string, index: number) => void
  /** 恢复整套文档集合 + 激活 id（项目载入专用，不标脏）。 */
  hydrateWorkbenchDocuments: (documents: WorkbenchDocument[], activeId: string | null) => void
  /** 写入/改写分镜方案对象（planner 落库、编辑器逐字段编辑）：置草稿态。按 documentId 索引；缺省回退 activeDocumentId。 */
  setStoryboardPlan: (plan: StoryboardPlan | null, documentId?: string, storyboardId?: string, syncSource?: boolean, createNew?: false | StoryboardInitiator) => StoryboardDesign | null
  /** 首次行内/批量生成把方案「落进画布」后调用：方案保留、转已落画布（卡片留痕）。按 documentId 索引；缺省回退 activeDocumentId。 */
  commitStoryboardPlan: (documentId?: string, storyboardId?: string) => void
  /** 丢弃方案：清空该文档的方案（卡片随之消失）。按 documentId 索引；缺省回退 activeDocumentId。 */
  discardStoryboardPlan: (documentId?: string) => void
  /** 项目载入专用：恢复整套方案映射，不标脏。 */
  hydrateStoryboardDesigns: (entries: Record<string, StoryboardDesign[]>) => void
}

type WorkbenchState = {
  persistRevision: number
  activeDocumentId: string
} & WorkbenchDocumentSlice

export type WorkbenchSliceCreator<T> = StateCreator<
  WorkbenchState,
  [['zustand/subscribeWithSelector', never]],
  [],
  T
>

/** 初始文档（模块级单例）：保证 workbenchDocuments[0] 与 activeDocumentId 指向同一篇。 */
const INITIAL_DOCUMENT = createDefaultWorkbenchDocument()

function resolveTargetDocumentId(documentId: string | undefined, get: () => WorkbenchState): string | null {
  const target = typeof documentId === 'string' && documentId.trim() ? documentId.trim() : get().activeDocumentId
  return target || null
}

function findDesign(state: WorkbenchState, id: string | null | undefined, documentId: string): StoryboardDesign | undefined {
  return state.storyboardDesignsByDocumentId[documentId]?.find((design) => design.id === id)
}

/**
 * 侧栏上那一行叫什么。**同一篇原稿里两行不许同名**——同名的两行在用户眼里就是「同一个」，
 * 而空白新建的 plan.title 本来就是空串，于是第二次新建看起来和第一次一模一样
 * （2026-09-21 真机截图：左栏两行都写着「分镜方案」）。
 *
 * 规则：基名没被占就用基名，占了就取**最小可用**序号（不是「已有几个 + 1」——删掉中间一个之后
 * 那个算法会重新发出一个已经在用的号）。
 */
function uniqueDesignTitle(existing: readonly StoryboardDesign[], base: string): string {
  const taken = new Set(existing.map((design) => design.title.trim()).filter(Boolean))
  if (!taken.has(base)) return base
  for (let index = 2; ; index += 1) {
    const candidate = `${base} ${index}`
    if (!taken.has(candidate)) return candidate
  }
}

function createDesign(documentId: string, plan: StoryboardPlan, sourceDocumentUpdatedAt: number, title?: string): StoryboardDesign {
  const now = Date.now()
  return {
    id: mintStoryboardDesignId(),
    documentId,
    title: title?.trim() || plan.title.trim(),
    plan,
    committed: false,
    status: 'draft',
    sourceDocumentUpdatedAt,
    createdAt: now,
    updatedAt: now,
  }
}

export const createWorkbenchDocumentSlice = (
  set: Parameters<WorkbenchSliceCreator<WorkbenchDocumentSlice>>[0],
  get: Parameters<WorkbenchSliceCreator<WorkbenchDocumentSlice>>[1],
  _store: Parameters<WorkbenchSliceCreator<WorkbenchDocumentSlice>>[2],
  projectPlan: (design: StoryboardDesign) => void,
): WorkbenchDocumentSlice => ({
  workbenchDocuments: [INITIAL_DOCUMENT],
  activeDocumentId: INITIAL_DOCUMENT.id,
  storyboardDesignsByDocumentId: {},
  activeStoryboardId: null,
  storyboardRowFocus: null,
  setStoryboardRowFocus: (storyboardRowFocus) => set({ storyboardRowFocus }),
  setWorkbenchDocument: (workbenchDocument) => {
    const normalized = normalizeWorkbenchDocument(workbenchDocument)
    set((state) => {
      const exists = state.workbenchDocuments.some((d) => d.id === normalized.id)
      return {
        workbenchDocuments: exists
          ? state.workbenchDocuments.map((d) => (d.id === normalized.id ? normalized : d))
          : [...state.workbenchDocuments, normalized],
        activeDocumentId: exists ? state.activeDocumentId : normalized.id,
        activeStoryboardId: exists ? state.activeStoryboardId : null,
        persistRevision: state.persistRevision + 1,
      }
    })
  },
  addWorkbenchDocument: () => {
    const doc = createDefaultWorkbenchDocument()
    set((state) => ({
      workbenchDocuments: [...state.workbenchDocuments, doc],
      activeDocumentId: doc.id,
      activeStoryboardId: null,
      persistRevision: state.persistRevision + 1,
    }))
    return doc
  },
  deleteWorkbenchDocument: (id) => {
    if (typeof id !== 'string' || !id.trim()) return
    set((state) => {
      if (state.workbenchDocuments.length <= 1) return state // 至少保留一篇
      const target = state.workbenchDocuments.find((d) => d.id === id)
      if (!target) return state
      const next = state.workbenchDocuments.filter((d) => d.id !== id)
      const nextActive = state.activeDocumentId === id ? next[0].id : state.activeDocumentId
      const nextDesigns = { ...state.storyboardDesignsByDocumentId }
      delete nextDesigns[id]
      const activeStoryboardId = state.activeDocumentId === id ? null : state.activeStoryboardId
      return {
        workbenchDocuments: next,
        activeDocumentId: nextActive,
        storyboardDesignsByDocumentId: nextDesigns,
        activeStoryboardId,
        persistRevision: state.persistRevision + 1,
      }
    })
  },
  renameWorkbenchDocument: (id, title) => {
    const trimmed = (title || '').trim()
    if (!trimmed) return
    set((state) => {
      if (!state.workbenchDocuments.some((d) => d.id === id)) return state
      return {
        workbenchDocuments: state.workbenchDocuments.map((d) => (d.id === id ? { ...d, title: trimmed, updatedAt: Date.now() } : d)),
        persistRevision: state.persistRevision + 1,
      }
    })
  },
  setActiveDocumentId: (id) => {
    if (typeof id !== 'string' || !id.trim()) return
    set((state) => {
      if (!state.workbenchDocuments.some((d) => d.id === id)) return state
      if (state.activeDocumentId === id) return state
      return { activeDocumentId: id, activeStoryboardId: null }
    })
  },
  hydrateWorkbenchDocuments: (documents, activeId) => {
    const normalized = documents.map(normalizeWorkbenchDocument)
    const safe = normalized.length ? normalized : [createDefaultWorkbenchDocument()]
    const active = safe.some((d) => d.id === activeId) ? (activeId as string) : safe[0].id
    set({ workbenchDocuments: safe, activeDocumentId: active, activeStoryboardId: null, storyboardRowFocus: null })
  },
  setActiveStoryboardId: (id, documentId) => {
    if (id === null) {
      set({ activeStoryboardId: null })
      return
    }
    const target = resolveTargetDocumentId(documentId, get)
    if (!target) return
    set((state) => {
      const design = findDesign(state, id, target)
      if (!design) return state
      return {
        activeDocumentId: target,
        activeStoryboardId: id,
      }
    })
  },
  addStoryboardDesign: ({ initiator, documentId, source, identity }) => {
    const target = resolveTargetDocumentId(documentId, get)
    if (!target) return null
    const state = get()
    const document = state.workbenchDocuments.find((item) => item.id === target)
    if (!document) return null
    if (identity && findDesign(state, identity.id, target)) return null
    const plan = source ?? createEmptyStoryboardPlan()
    const existing = state.storyboardDesignsByDocumentId[target] ?? []
    const fallback = i18n.t('storyboardEditor.planCard.defaultTitle')
    // 模型给了名字就用模型的（2026-09-21 拍板：Agent 方案标题 = 模型给的）；
    // 没给、或者是手动新建 / 复制，就沿用同一套编号，两条路一个 owner。
    const title = identity?.title.trim() || uniqueDesignTitle(existing, (source ? plan.title.trim() : '') || fallback)
    // 空白新建**只给行一个名字，不写进 plan**：`isEmptyStoryboardPlan` 判「这还是那个空白起手式吗」
    // 靠的就是 plan.title 为空（`storyboardPlan.ts:38`）。往 plan 里写名字，Agent 下一份方案就不再
    // 替换这个起手式，而是**再开一份**——那正是上一轮「每轮新开一份」的病。
    const nextPlan = source ? { ...plan, title } : plan
    const design = { ...createDesign(target, nextPlan, document.updatedAt, title), ...(identity ? { id: identity.id } : {}) }
    if (!designWritable(design, 'addStoryboardDesign')) return null
    set((current) => ({
      storyboardDesignsByDocumentId: {
        ...current.storyboardDesignsByDocumentId,
        [target]: [...(current.storyboardDesignsByDocumentId[target] ?? []), design],
      },
      ...activationAfterCreate(initiator, target, design.id),
      persistRevision: current.persistRevision + 1,
    }))
    if (source) projectPlan(design)
    return design
  },
  duplicateStoryboardDesign: (id, documentId) => {
    const target = resolveTargetDocumentId(documentId, get)
    if (!target) return null
    const source = findDesign(get(), id, target)
    if (!source) return null
    return get().addStoryboardDesign({ initiator: 'user', documentId: target, source: source.plan })
  },
  renameStoryboardDesign: (id, title) => {
    const trimmed = title.trim()
    if (!trimmed) return
    set((state) => {
      for (const [documentId, designs] of Object.entries(state.storyboardDesignsByDocumentId)) {
        const currentDesign = designs.find((design) => design.id === id)
        if (!currentDesign) continue
        const renamedDesign = { ...currentDesign, title: trimmed, updatedAt: Date.now(), plan: { ...currentDesign.plan, title: trimmed } }
        return {
          storyboardDesignsByDocumentId: {
            ...state.storyboardDesignsByDocumentId,
            [documentId]: designs.map((design) => (design.id === id ? renamedDesign : design)),
          },
          persistRevision: state.persistRevision + 1,
        }
      }
      return state
    })
  },
  deleteStoryboardDesign: (id, documentId) => {
    const target = resolveTargetDocumentId(documentId, get)
    if (!target) return
    set((state) => {
      const designs = state.storyboardDesignsByDocumentId[target] ?? []
      if (!designs.some((design) => design.id === id)) return state
      const nextDesigns = designs.filter((design) => design.id !== id)
      const deletingVisibleDesign = state.activeDocumentId === target && state.activeStoryboardId === id
      const nextActive = deletingVisibleDesign ? nextDesigns[0]?.id ?? null : state.activeStoryboardId
      return {
        storyboardDesignsByDocumentId: { ...state.storyboardDesignsByDocumentId, [target]: nextDesigns },
        activeStoryboardId: nextActive,
        persistRevision: state.persistRevision + 1,
      }
    })
  },
  restoreStoryboardDesign: (design, documentId, index) => {
    if (!designWritable(design, 'restoreStoryboardDesign')) return
    set((state) => {
      const designs = state.storyboardDesignsByDocumentId[documentId] ?? []
      // 已经在了 = 这一笔撤过了，或者别人把同一个 id 写回来了。两种情况都不该再插一遍。
      if (designs.some((item) => item.id === design.id)) return state
      const next = [...designs]
      next.splice(Math.max(0, Math.min(index, next.length)), 0, design)
      return {
        storyboardDesignsByDocumentId: { ...state.storyboardDesignsByDocumentId, [documentId]: next },
        persistRevision: state.persistRevision + 1,
      }
    })
  },
  setStoryboardPlan: (storyboardPlan, documentId, storyboardId, syncSource = false, createNew: false | StoryboardInitiator = false) => {
    // P0-6:方案是 per-project 持久化产物 → bump persistRevision 触发防抖落盘(否则用户手改的方案不保存)。
    // 写/改方案一律置草稿态(被编辑即与画布上旧节点不一致)。P4:按 documentId 索引（缺省回退激活文档）。
    const target = resolveTargetDocumentId(documentId, get)
    if (!target) return null
    let appliedDesign: StoryboardDesign | null = null
    set((state) => {
      const designs = state.storyboardDesignsByDocumentId[target] ?? []
      // A new planner run must not reuse a design the user selected while the
      // async result was in flight. Ordinary UI and compatibility calls keep
      // updating the currently visible design.
      const visible = findDesign(state, state.activeStoryboardId, target)
      const replaceEmptyStarter = createNew !== false && !storyboardId && visible && isEmptyStoryboardPlan(visible.plan)
      const active = storyboardId
        ? findDesign(state, storyboardId, target)
        : createNew !== false && !replaceEmptyStarter
          ? undefined
          : visible
      // A revision whose target was deleted while the planner was running is
      // obsolete. Do not resurrect it as a new design.
      if (storyboardId && !active) return state
      if (storyboardPlan === null) {
        if (!active) return state
        const nextDesigns = designs.filter((design) => design.id !== active.id)
        const deletingVisibleDesign = state.activeDocumentId === target && state.activeStoryboardId === active.id
        const nextActive = deletingVisibleDesign ? nextDesigns[0]?.id ?? null : state.activeStoryboardId
        return {
          storyboardDesignsByDocumentId: { ...state.storyboardDesignsByDocumentId, [target]: nextDesigns },
          activeStoryboardId: nextActive,
          persistRevision: state.persistRevision + 1,
        }
      }
      const sourceDocumentUpdatedAt = state.workbenchDocuments.find((document) => document.id === target)?.updatedAt ?? Date.now()
      const nextDesign = active
        ? {
            ...active,
            plan: storyboardPlan,
            title: storyboardPlan.title.trim() || active.title,
            committed: false,
            status: 'draft' as const,
            sourceDocumentUpdatedAt: syncSource ? sourceDocumentUpdatedAt : active.sourceDocumentUpdatedAt,
            updatedAt: Date.now(),
          }
        : createDesign(target, storyboardPlan, sourceDocumentUpdatedAt)
      if (!designWritable(nextDesign, 'setStoryboardPlan')) return state
      appliedDesign = nextDesign
      const nextDesigns = active ? designs.map((design) => (design.id === active.id ? nextDesign : design)) : [...designs, nextDesign]
      // 只有「这一笔新建了一份方案」才存在打开谁的问题；改已有方案不动用户正在看的那份。
      // 发起人不说（`createNew` 缺省）= 用户在编辑器里直接动手，沿用老行为。
      const created = !active
      const reveal = created && state.activeDocumentId === target && state.activeStoryboardId === null
      return {
        storyboardDesignsByDocumentId: { ...state.storyboardDesignsByDocumentId, [target]: nextDesigns },
        ...(reveal ? activationAfterCreate(createNew || 'user', target, nextDesign.id) : {}),
        persistRevision: state.persistRevision + 1,
      }
    })
    if (appliedDesign) projectPlan(appliedDesign)
    return appliedDesign
  },
  commitStoryboardPlan: (documentId, storyboardId) => {
    // v5 起没有「确认落画布」按钮:首次行内/批量生成即落画布并调用本方法。方案保留(卡片留痕)、转已落画布,bump 落盘 committed 状态。
    const target = resolveTargetDocumentId(documentId, get)
    if (!target) return
    set((state) => {
      const designs = state.storyboardDesignsByDocumentId[target] ?? []
      // An explicit id is an exact commit contract. If that design disappeared
      // while canvas landing was in flight, committing a sibling is corruption.
      const active = storyboardId === undefined
        ? findDesign(state, state.activeStoryboardId, target) ?? designs[0]
        : findDesign(state, storyboardId, target)
      if (storyboardId !== undefined && !active) return state
      if (!active || active.committed) return state
      const nextDesigns = active ? designs.map((design) => design.id === active.id ? { ...design, committed: true, status: 'committed' as const, updatedAt: Date.now() } : design) : designs
      return {
        storyboardDesignsByDocumentId: { ...state.storyboardDesignsByDocumentId, [target]: nextDesigns },
        persistRevision: state.persistRevision + 1,
      }
    })
  },
  discardStoryboardPlan: (documentId) => {
    const target = resolveTargetDocumentId(documentId, get)
    if (!target) return
    set((state) => {
      const designs = state.storyboardDesignsByDocumentId[target] ?? []
      const active = findDesign(state, state.activeStoryboardId, target) ?? designs[0]
      const nextDesigns = active ? designs.filter((design) => design.id !== active.id) : []
      const deletingVisibleDesign = state.activeDocumentId === target && state.activeStoryboardId === active?.id
      const nextActive = deletingVisibleDesign ? nextDesigns[0]?.id ?? null : state.activeStoryboardId
      return { storyboardDesignsByDocumentId: { ...state.storyboardDesignsByDocumentId, [target]: nextDesigns }, activeStoryboardId: nextActive, persistRevision: state.persistRevision + 1 }
    })
  },
  hydrateStoryboardDesigns: (entries) => {
    const safeEntries: Record<string, StoryboardDesign[]> = {}
    for (const [documentId, designs] of Object.entries(entries)) {
      const safe = designs.filter((design) => design && design.documentId === documentId && design.plan)
      if (!safe.length) continue
      safeEntries[documentId] = safe
    }
    const activeDocumentId = get().activeDocumentId
    const activeStoryboardId = safeEntries[activeDocumentId]?.[0]?.id ?? null
    set({ storyboardDesignsByDocumentId: safeEntries, activeStoryboardId })
  },
})
