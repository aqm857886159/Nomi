import { WORKBENCH_API_BASE, throwWorkbenchApiError, withWorkbenchAuth, workbenchApiFetch } from './http'

export type TaskKind =
  | 'chat'
  | 'prompt_refine'
  | 'text_to_image'
  | 'image_to_prompt'
  | 'image_to_video'
  | 'text_to_video'
  | 'image_edit'

export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export type TaskAssetDto = {
  type: 'image' | 'video'
  url: string
  thumbnailUrl?: string | null
  assetId?: string | null
  assetRefId?: string | null
  assetName?: string | null
}

export type TaskResultDto = {
  id: string
  kind: TaskKind
  status: TaskStatus
  assets: TaskAssetDto[]
  raw: unknown
}

export type TaskRequestDto = {
  kind: TaskKind
  prompt: string
  negativePrompt?: string
  seed?: number
  width?: number
  height?: number
  steps?: number
  cfgScale?: number
  extras?: Record<string, unknown>
}

export type FetchWorkbenchTaskResultRequestDto = {
  taskId: string
  vendor?: string
  taskKind?: TaskKind
  prompt?: string | null
  modelKey?: string | null
}

export type FetchWorkbenchTaskResultResponseDto = {
  vendor: string
  result: TaskResultDto
}

export async function runWorkbenchTaskByVendor(vendor: string, request: TaskRequestDto): Promise<TaskResultDto> {
  const normalizedVendor = String(vendor || '').trim()
  if (!normalizedVendor) throw new Error('vendor is required')
  const response = await workbenchApiFetch(`${WORKBENCH_API_BASE}/tasks`, withWorkbenchAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vendor: normalizedVendor, request }),
  }))
  if (!response.ok) {
    await throwWorkbenchApiError(response, `run task failed: ${response.status}`)
  }
  return response.json() as Promise<TaskResultDto>
}

export async function fetchWorkbenchTaskResultByVendor(
  payload: FetchWorkbenchTaskResultRequestDto,
): Promise<FetchWorkbenchTaskResultResponseDto> {
  const response = await workbenchApiFetch(`${WORKBENCH_API_BASE}/tasks/result`, withWorkbenchAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!response.ok) {
    await throwWorkbenchApiError(response, `fetch task result failed: ${response.status}`)
  }
  const body = await response.json() as unknown
  if (body && typeof body === 'object' && 'result' in body) {
    return body as FetchWorkbenchTaskResultResponseDto
  }
  return {
    vendor: String(payload.vendor || ''),
    result: body as TaskResultDto,
  }
}
