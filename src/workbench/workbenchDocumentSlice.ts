import type { StateCreator } from 'zustand'
import type { StoryboardPlan } from './generationCanvas/agent/storyboardPlan'
import { createDefaultWorkbenchDocument, normalizeWorkbenchDocument, type WorkbenchDocument } from './workbenchTypes'

/** 一篇原稿的分镜方案条目（P4：storyboardPlans 的值）。 */
export type StoryboardPlanEntry = {
  plan: StoryboardPlan
  committed: boolean
}

/** 创作文档 + 分镜方案的状态与 action（P2/P4）。从 workbenchStore 拆出，守 R9/R12 巨壳门。 */
export type WorkbenchDocumentSlice = {
  /** 原稿文档集合（有序，多文档侧栏真相源）。随项目持久化。 */
  workbenchDocuments: WorkbenchDocument[]
  /** 当前激活的原稿文档 id（切换文档 = 切编辑器内容）。随项目持久化。 */
  activeDocumentId: string
  /** 每篇原稿的分镜方案（P4：按 documentId 索引，切原稿切方案，不再串稿）。随项目持久化。 */
  storyboardPlans: Record<string, StoryboardPlanEntry>
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
  /** 恢复整套文档集合 + 激活 id（项目载入专用，不标脏）。 */
  hydrateWorkbenchDocuments: (documents: WorkbenchDocument[], activeId: string | null) => void
  /** 写入/改写分镜方案对象（planner 落库、编辑器逐字段编辑）：置草稿态。按 documentId 索引；缺省回退 activeDocumentId。 */
  setStoryboardPlan: (plan: StoryboardPlan | null, documentId?: string) => void
  /** 确认落画布后：方案保留、转「已落画布」（卡片留痕）。按 documentId 索引；缺省回退 activeDocumentId。 */
  commitStoryboardPlan: (documentId?: string) => void
  /** 丢弃方案：清空该文档的方案（卡片随之消失）。按 documentId 索引；缺省回退 activeDocumentId。 */
  discardStoryboardPlan: (documentId?: string) => void
  /** 项目载入专用：恢复整套方案映射，不标脏（区别于用户动作 setStoryboardPlan）。 */
  hydrateStoryboardPlans: (entries: Record<string, StoryboardPlanEntry>) => void
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

export const createWorkbenchDocumentSlice: WorkbenchSliceCreator<WorkbenchDocumentSlice> = (set, get) => ({
  workbenchDocuments: [INITIAL_DOCUMENT],
  activeDocumentId: INITIAL_DOCUMENT.id,
  storyboardPlans: {},
  setWorkbenchDocument: (workbenchDocument) => {
    const normalized = normalizeWorkbenchDocument(workbenchDocument)
    set((state) => {
      const exists = state.workbenchDocuments.some((d) => d.id === normalized.id)
      return {
        workbenchDocuments: exists
          ? state.workbenchDocuments.map((d) => (d.id === normalized.id ? normalized : d))
          : [...state.workbenchDocuments, normalized],
        activeDocumentId: exists ? state.activeDocumentId : normalized.id,
        persistRevision: state.persistRevision + 1,
      }
    })
  },
  addWorkbenchDocument: () => {
    const doc = createDefaultWorkbenchDocument()
    set((state) => ({
      workbenchDocuments: [...state.workbenchDocuments, doc],
      activeDocumentId: doc.id,
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
      return {
        workbenchDocuments: next,
        activeDocumentId: nextActive,
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
      return { activeDocumentId: id }
    })
  },
  hydrateWorkbenchDocuments: (documents, activeId) => {
    const normalized = documents.map(normalizeWorkbenchDocument)
    const safe = normalized.length ? normalized : [createDefaultWorkbenchDocument()]
    const active = safe.some((d) => d.id === activeId) ? (activeId as string) : safe[0].id
    set({ workbenchDocuments: safe, activeDocumentId: active })
  },
  setStoryboardPlan: (storyboardPlan, documentId) => {
    // P0-6:方案是 per-project 持久化产物 → bump persistRevision 触发防抖落盘(否则用户手改的方案不保存)。
    // 写/改方案一律置草稿态(被编辑即与画布上旧节点不一致)。P4:按 documentId 索引（缺省回退激活文档）。
    const target = resolveTargetDocumentId(documentId, get)
    if (!target) return
    set((state) => {
      if (storyboardPlan === null) {
        if (!state.storyboardPlans[target]) return state
        const next = { ...state.storyboardPlans }
        delete next[target]
        return { storyboardPlans: next, persistRevision: state.persistRevision + 1 }
      }
      return {
        storyboardPlans: { ...state.storyboardPlans, [target]: { plan: storyboardPlan, committed: false } },
        persistRevision: state.persistRevision + 1,
      }
    })
  },
  commitStoryboardPlan: (documentId) => {
    // 确认落画布:方案保留(卡片留痕)、转已落画布。bump 落盘 committed 状态。
    const target = resolveTargetDocumentId(documentId, get)
    if (!target) return
    set((state) => {
      const entry = state.storyboardPlans[target]
      if (!entry || entry.committed) return state
      return {
        storyboardPlans: { ...state.storyboardPlans, [target]: { ...entry, committed: true } },
        persistRevision: state.persistRevision + 1,
      }
    })
  },
  discardStoryboardPlan: (documentId) => {
    const target = resolveTargetDocumentId(documentId, get)
    if (!target) return
    set((state) => {
      if (!state.storyboardPlans[target]) return state
      const next = { ...state.storyboardPlans }
      delete next[target]
      return { storyboardPlans: next, persistRevision: state.persistRevision + 1 }
    })
  },
  hydrateStoryboardPlans: (entries) => {
    // 载入态:一次性设整套映射、不 bump persistRevision(restore 非用户编辑,别标脏触发回存)。
    set({ storyboardPlans: entries })
  },
})
