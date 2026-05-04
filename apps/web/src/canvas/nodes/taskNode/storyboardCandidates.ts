import type { TaskNodeImageResult } from '../taskNodeSchema'

type StoryboardCandidateInput = {
  imageResults?: unknown
  imageUrl?: unknown
}

type StoryboardCandidate = {
  url: string
  label: string
  sourceType: 'image'
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readImageResults(value: unknown): TaskNodeImageResult[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const url = readText(record.url)
    if (!url) return []
    return [{
      url,
      title: readText(record.title),
    } as TaskNodeImageResult]
  })
}

export function extractStoryboardFirstFrameCandidates(
  data: StoryboardCandidateInput,
  sourceLabel: string,
): StoryboardCandidate[] {
  const imageResults = readImageResults(data.imageResults)
  const shotEntries = imageResults
    .filter((item) => item.title && /^镜头\s*\d+/i.test(item.title))
    .map((item) => ({
      url: item.url.trim(),
      label: `${sourceLabel} · ${item.title.trim()}`,
      sourceType: 'image' as const,
    }))
    .filter((item) => Boolean(item.url))

  if (shotEntries.length) {
    return shotEntries.slice(0, 16)
  }

  const fallback: StoryboardCandidate[] = []
  const push = (value?: unknown, label?: string) => {
    const next = readText(value)
    if (!next) return
    fallback.push({
      url: next,
      label: label ? `${sourceLabel} · ${label}` : sourceLabel,
      sourceType: 'image',
    })
  }

  push(data.imageUrl, '主图')
  imageResults.forEach((item, index) => {
    push(item.url, item.title || `候选 ${index + 1}`)
  })
  return fallback.slice(0, 16)
}
