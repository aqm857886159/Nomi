import type { StateCreator } from 'zustand'
import type { StoryboardPlan } from './generationCanvas/agent/storyboardPlan'
import {
  createDefaultWorkbenchDocument,
  mintStoryboardDesignId,
  normalizeWorkbenchDocument,
  type StoryboardDesign,
  type WorkbenchDocument,
} from './workbenchTypes'

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
  /** Multiple storyboard designs per draft. `storyboardPlans` remains as a compatibility projection. */
  storyboardDesignsByDocumentId: Record<string, StoryboardDesign[]>
  activeStoryboardId: string | null
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
  addStoryboardDesign: (documentId?: string, source?: StoryboardPlan) => StoryboardDesign | null
  duplicateStoryboardDesign: (id: string, documentId?: string) => StoryboardDesign | null
  renameStoryboardDesign: (id: string, title: string) => void
  deleteStoryboardDesign: (id: string, documentId?: string) => void
  /** 恢复整套文档集合 + 激活 id（项目载入专用，不标脏）。 */
  hydrateWorkbenchDocuments: (documents: WorkbenchDocument[], activeId: string | null) => void
  /** 写入/改写分镜方案对象（planner 落库、编辑器逐字段编辑）：置草稿态。按 documentId 索引；缺省回退 activeDocumentId。 */
  setStoryboardPlan: (plan: StoryboardPlan | null, documentId?: string, storyboardId?: string, syncSource?: boolean, createNew?: boolean) => StoryboardDesign | null
  /** 首次行内/批量生成把方案「落进画布」后调用：方案保留、转已落画布（卡片留痕）。按 documentId 索引；缺省回退 activeDocumentId。 */
  commitStoryboardPlan: (documentId?: string, storyboardId?: string) => void
  /** 丢弃方案：清空该文档的方案（卡片随之消失）。按 documentId 索引；缺省回退 activeDocumentId。 */
  discardStoryboardPlan: (documentId?: string) => void
  /** 项目载入专用：恢复整套方案映射，不标脏（区别于用户动作 setStoryboardPlan）。 */
  hydrateStoryboardPlans: (entries: Record<string, StoryboardPlanEntry>) => void
  hydrateStoryboardDesigns: (entries: Record<string, StoryboardDesign[]>, fallbackEntries?: Record<string, StoryboardPlanEntry>) => void
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

function designToEntry(design: StoryboardDesign): StoryboardPlanEntry {
  return { plan: design.plan, committed: design.committed }
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

export const createWorkbenchDocumentSlice: WorkbenchSliceCreator<WorkbenchDocumentSlice> = (set, get) => ({
  workbenchDocuments: [INITIAL_DOCUMENT],
  activeDocumentId: INITIAL_DOCUMENT.id,
  storyboardPlans: {},
  storyboardDesignsByDocumentId: {},
  activeStoryboardId: null,
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
      const nextPlans = { ...state.storyboardPlans }
      delete nextPlans[id]
      return {
        workbenchDocuments: next,
        activeDocumentId: nextActive,
        storyboardDesignsByDocumentId: nextDesigns,
        storyboardPlans: nextPlans,
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
    set({ workbenchDocuments: safe, activeDocumentId: active, activeStoryboardId: null })
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
        storyboardPlans: { ...state.storyboardPlans, [target]: designToEntry(design) },
      }
    })
  },
  addStoryboardDesign: (documentId, source) => {
    const target = resolveTargetDocumentId(documentId, get)
    if (!target) return null
    const state = get()
    const document = state.workbenchDocuments.find((item) => item.id === target)
    if (!document) return null
    const plan = source ?? state.storyboardPlans[target]?.plan
    if (!plan) return null
    const nextNumber = (state.storyboardDesignsByDocumentId[target] ?? []).length + 1
    const title = `${plan.title.trim()} ${nextNumber}`.trim()
    const design = createDesign(target, { ...plan, title }, document.updatedAt, title)
    set((current) => ({
      storyboardDesignsByDocumentId: {
        ...current.storyboardDesignsByDocumentId,
        [target]: [...(current.storyboardDesignsByDocumentId[target] ?? []), design],
      },
      storyboardPlans: { ...current.storyboardPlans, [target]: designToEntry(design) },
      activeDocumentId: target,
      activeStoryboardId: design.id,
      persistRevision: current.persistRevision + 1,
    }))
    return design
  },
  duplicateStoryboardDesign: (id, documentId) => {
    const target = resolveTargetDocumentId(documentId, get)
    if (!target) return null
    const source = findDesign(get(), id, target)
    if (!source) return null
    return get().addStoryboardDesign(target, source.plan)
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
          storyboardPlans: state.activeStoryboardId === id
            ? { ...state.storyboardPlans, [documentId]: designToEntry(renamedDesign) }
            : state.storyboardPlans,
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
      const nextEntry = state.activeDocumentId === target && nextActive
        ? nextDesigns.find((design) => design.id === nextActive)
        : nextDesigns[0]
      return {
        storyboardDesignsByDocumentId: { ...state.storyboardDesignsByDocumentId, [target]: nextDesigns },
        storyboardPlans: nextEntry
          ? { ...state.storyboardPlans, [target]: designToEntry(nextEntry) }
          : (() => { const next = { ...state.storyboardPlans }; delete next[target]; return next })(),
        activeStoryboardId: nextActive,
        persistRevision: state.persistRevision + 1,
      }
    })
  },
  setStoryboardPlan: (storyboardPlan, documentId, storyboardId, syncSource = false, createNew = false) => {
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
      const active = storyboardId
        ? findDesign(state, storyboardId, target)
        : createNew
          ? undefined
          : findDesign(state, state.activeStoryboardId, target)
      // A revision whose target was deleted while the planner was running is
      // obsolete. Do not resurrect it as a new design.
      if (storyboardId && !active) return state
      if (storyboardPlan === null) {
        if (!active) return state
        const nextDesigns = designs.filter((design) => design.id !== active.id)
        const deletingVisibleDesign = state.activeDocumentId === target && state.activeStoryboardId === active.id
        const nextActive = deletingVisibleDesign ? nextDesigns[0]?.id ?? null : state.activeStoryboardId
        const nextEntry = state.activeDocumentId === target && nextActive
          ? nextDesigns.find((design) => design.id === nextActive)
          : nextDesigns[0]
        const nextPlans = { ...state.storyboardPlans }
        if (nextEntry) nextPlans[target] = designToEntry(nextEntry)
        else delete nextPlans[target]
        return {
          storyboardDesignsByDocumentId: { ...state.storyboardDesignsByDocumentId, [target]: nextDesigns },
          storyboardPlans: nextPlans,
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
      appliedDesign = nextDesign
      const nextDesigns = active ? designs.map((design) => (design.id === active.id ? nextDesign : design)) : [...designs, nextDesign]
      const shouldReveal = state.activeDocumentId === target
        && (storyboardId ? state.activeStoryboardId === storyboardId : state.activeStoryboardId === null)
      const visibleDesign = !shouldReveal && state.activeDocumentId === target && state.activeStoryboardId
        ? nextDesigns.find((design) => design.id === state.activeStoryboardId)
        : nextDesign
      return {
        storyboardDesignsByDocumentId: { ...state.storyboardDesignsByDocumentId, [target]: nextDesigns },
        storyboardPlans: { ...state.storyboardPlans, [target]: designToEntry(visibleDesign ?? nextDesign) },
        activeDocumentId: shouldReveal ? target : state.activeDocumentId,
        activeStoryboardId: shouldReveal ? nextDesign.id : state.activeStoryboardId,
        persistRevision: state.persistRevision + 1,
      }
    })
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
      const entry = active ? designToEntry(active) : state.storyboardPlans[target]
      if (!entry || entry.committed) return state
      const nextDesigns = active ? designs.map((design) => design.id === active.id ? { ...design, committed: true, status: 'committed' as const, updatedAt: Date.now() } : design) : designs
      const visibleDesign = state.activeDocumentId === target && state.activeStoryboardId && state.activeStoryboardId !== active?.id
        ? nextDesigns.find((design) => design.id === state.activeStoryboardId)
        : active ? nextDesigns.find((design) => design.id === active.id) : undefined
      return {
        storyboardPlans: { ...state.storyboardPlans, [target]: visibleDesign ? designToEntry(visibleDesign) : { ...entry, committed: true } },
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
      if (!active && !state.storyboardPlans[target]) return state
      const nextDesigns = active ? designs.filter((design) => design.id !== active.id) : []
      const deletingVisibleDesign = state.activeDocumentId === target && state.activeStoryboardId === active?.id
      const nextActive = deletingVisibleDesign ? nextDesigns[0]?.id ?? null : state.activeStoryboardId
      const next = { ...state.storyboardPlans }
      const nextEntry = state.activeDocumentId === target && nextActive
        ? nextDesigns.find((design) => design.id === nextActive)
        : nextDesigns[0]
      if (nextEntry) next[target] = designToEntry(nextEntry)
      else delete next[target]
      return { storyboardPlans: next, storyboardDesignsByDocumentId: { ...state.storyboardDesignsByDocumentId, [target]: nextDesigns }, activeStoryboardId: nextActive, persistRevision: state.persistRevision + 1 }
    })
  },
  hydrateStoryboardPlans: (entries) => {
    // 载入态:一次性设整套映射、不 bump persistRevision(restore 非用户编辑,别标脏触发回存)。
    const designsByDocument: Record<string, StoryboardDesign[]> = {}
    for (const [documentId, entry] of Object.entries(entries)) {
      const document = get().workbenchDocuments.find((item) => item.id === documentId)
      const design = createDesign(documentId, entry.plan, document?.updatedAt ?? Date.now(), entry.plan.title)
      design.committed = entry.committed
      design.status = entry.committed ? 'committed' : 'draft'
      designsByDocument[documentId] = [design]
    }
    set({ storyboardPlans: entries, storyboardDesignsByDocumentId: designsByDocument, activeStoryboardId: null })
  },
  hydrateStoryboardDesigns: (entries, fallbackEntries = {}) => {
    const safeEntries: Record<string, StoryboardDesign[]> = {}
    const projection: Record<string, StoryboardPlanEntry> = {}
    for (const [documentId, designs] of Object.entries(entries)) {
      const safe = designs.filter((design) => design && design.documentId === documentId && design.plan)
      if (!safe.length) continue
      safeEntries[documentId] = safe
      projection[documentId] = designToEntry(safe[0])
    }
    // Mixed-version manifests can contain new designs for one document while
    // another document still exists only in the legacy projection. Migrate the
    // missing documents individually instead of globally choosing one format.
    for (const [documentId, entry] of Object.entries(fallbackEntries)) {
      if (safeEntries[documentId]?.length) continue
      const document = get().workbenchDocuments.find((item) => item.id === documentId)
      const design = createDesign(documentId, entry.plan, document?.updatedAt ?? Date.now(), entry.plan.title)
      design.committed = entry.committed
      design.status = entry.committed ? 'committed' : 'draft'
      safeEntries[documentId] = [design]
      projection[documentId] = designToEntry(design)
    }
    set({ storyboardDesignsByDocumentId: safeEntries, storyboardPlans: projection, activeStoryboardId: null })
  },
})
