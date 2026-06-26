import React from 'react'
import useSWR, { mutate } from 'swr'
import {
  createLocalProject as createProjectRecord,
  deleteLocalProject as deleteProjectRecord,
  listLocalProjects as listProjectRecords,
  readLocalProject,
  saveLocalProject as saveProjectRecord,
} from '../project/projectRepository'
import type {
  WorkbenchProjectRecordV1 as LocalProjectRecord,
  WorkbenchProjectSummary as LocalProjectSummary,
} from '../project/projectRecordSchema'
import type { GenerationCanvasSnapshot } from '../generationCanvas/model/generationCanvasTypes'
import type { TimelineState } from '../timeline/timelineTypes'
import type { WorkbenchDocument } from '../workbenchTypes'

const LOCAL_PROJECTS_SWR_KEY = 'nomi:local-projects:v1'

function toProjectSummary(record: LocalProjectRecord): LocalProjectSummary {
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    revision: record.revision,
    savedAt: record.savedAt,
    thumbStyle: record.thumbStyle,
    thumbnail: record.thumbnail,
    thumbnailUrls: record.thumbnailUrls,
    seedKey: record.seedKey,
    source: record.source,
    rootPath: record.rootPath,
    missing: record.missing,
  }
}

function sortProjectSummaries(items: LocalProjectSummary[]): LocalProjectSummary[] {
  return [...items].sort((left, right) => right.updatedAt - left.updatedAt)
}

function publishLocalProjectRecord(record: LocalProjectRecord): void {
  const summary = toProjectSummary(record)
  void mutate<LocalProjectSummary[]>(
    LOCAL_PROJECTS_SWR_KEY,
    (current) => {
      const items = Array.isArray(current) ? current : listProjectRecords()
      const index = items.findIndex((project) => project.id === summary.id)
      if (index < 0) return sortProjectSummaries([summary, ...items])
      const next = [...items]
      next[index] = summary
      return sortProjectSummaries(next)
    },
    { revalidate: false },
  )
}

function unpublishLocalProject(projectId: string): void {
  void mutate<LocalProjectSummary[]>(
    LOCAL_PROJECTS_SWR_KEY,
    (current) => {
      const items = Array.isArray(current) ? current : listProjectRecords()
      return items.filter((project) => project.id !== projectId)
    },
    { revalidate: false },
  )
}

export function listLocalProjects(): LocalProjectSummary[] {
  return listProjectRecords()
}

export function useLocalProjects(): {
  projects: LocalProjectSummary[]
  refreshProjects: () => void
} {
  const { data, mutate: mutateProjects } = useSWR<LocalProjectSummary[]>(
    LOCAL_PROJECTS_SWR_KEY,
    () => listProjectRecords(),
    {
      fallbackData: [],
      revalidateOnMount: true,
      revalidateIfStale: false,
      // 从 Claude Code/外部 MCP 切回 Nomi 聚焦时重读列表——外部新建的项目立刻出现（治「看不到新建项目」）。
      revalidateOnFocus: true,
      revalidateOnReconnect: false,
    },
  )
  const refreshProjects = React.useCallback(() => {
    void mutateProjects(listProjectRecords(), { revalidate: false })
  }, [mutateProjects])
  return {
    projects: data ?? [],
    refreshProjects,
  }
}

export function createLocalProject(name?: string, templateId?: string, options: { rootPath?: string; seedKey?: string } = {}): LocalProjectRecord {
  const record = createProjectRecord(name, templateId, options)
  publishLocalProjectRecord(record)
  return record
}

export { readLocalProject }

export function saveLocalProject(
  projectId: string,
  state: {
    workbenchDocument: WorkbenchDocument
    timeline: TimelineState
    generationCanvas: GenerationCanvasSnapshot
  },
  name?: string,
): LocalProjectRecord {
  const record = saveProjectRecord(projectId, state, name)
  publishLocalProjectRecord(record)
  return record
}

export function deleteLocalProject(projectId: string): void {
  deleteProjectRecord(projectId)
  unpublishLocalProject(projectId)
}

export type {
  LocalProjectRecord,
  LocalProjectSummary,
}
