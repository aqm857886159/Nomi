type RemoveBackgroundProgress = {
  key: string
  current: number
  total: number
}

type WorkerRequestInput = { type: 'remove'; blob: Blob }

type WorkerResponse =
  | { id: number; type: 'done'; blob?: Blob }
  | { id: number; type: 'progress'; key: string; current: number; total: number }
  | { id: number; type: 'error'; error: string }

type PendingRequest = {
  reject: (error: Error) => void
  resolve: (blob?: Blob) => void
  onProgress?: (progress: RemoveBackgroundProgress) => void
}

let removeBackgroundWorker: Worker | null = null
let nextRequestId = 1
const pendingRequests = new Map<number, PendingRequest>()

function getRemoveBackgroundWorker(): Worker {
  if (removeBackgroundWorker) return removeBackgroundWorker
  removeBackgroundWorker = new Worker(new URL('./removeBackground.worker.ts', import.meta.url), {
    name: 'nomi-remove-background',
    type: 'module',
  })
  removeBackgroundWorker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
    const response = event.data
    const pending = pendingRequests.get(response.id)
    if (!pending) return

    if (response.type === 'progress') {
      pending.onProgress?.({ key: response.key, current: response.current, total: response.total })
      return
    }

    pendingRequests.delete(response.id)
    if (response.type === 'error') {
      pending.reject(new Error(response.error))
      return
    }
    pending.resolve(response.blob)
  })
  removeBackgroundWorker.addEventListener('error', (event) => {
    const error = new Error(event.message || 'Remove background worker failed')
    pendingRequests.forEach((pending) => pending.reject(error))
    pendingRequests.clear()
    removeBackgroundWorker?.terminate()
    removeBackgroundWorker = null
  })
  return removeBackgroundWorker
}

function postWorkerRequest(
  request: WorkerRequestInput,
  onProgress?: (progress: RemoveBackgroundProgress) => void,
): Promise<Blob | undefined> {
  const id = nextRequestId++
  const worker = getRemoveBackgroundWorker()
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject, onProgress })
    worker.postMessage({ ...request, id })
  })
}

export async function removeBackgroundBlob(
  imageUrl: string,
  onProgress?: (progress: RemoveBackgroundProgress) => void,
): Promise<Blob> {
  const blob = await toBlob(imageUrl)
  const result = await postWorkerRequest({ type: 'remove', blob }, onProgress)
  if (!result) throw new Error('Remove background did not return an image')
  return result
}

export async function removeBackground(
  imageUrl: string,
  onProgress?: (progress: RemoveBackgroundProgress) => void,
): Promise<string> {
  const blob = await removeBackgroundBlob(imageUrl, onProgress)
  return blobToDataUrl(blob)
}

async function toBlob(url: string): Promise<Blob> {
  // data: URL 直接解码——renderer CSP 的 connect-src 不含 data:，对其 fetch() 会被拦并刷 CSP 报错。
  // 节点图在本地持久化失败时会回退成 data: URL（useNodeImageEditing），导入图同理，故这条路真实可达。
  if (url.startsWith('data:')) {
    const decoded = dataUrlToBlob(url)
    if (decoded) return decoded
  }
  const fetched = await fetchImageBlob(url)
  if (fetched) return fetched
  return imageElementToBlob(url)
}

function dataUrlToBlob(url: string): Blob | null {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(url)
  if (!match) return null
  const mime = match[1] || 'application/octet-stream'
  const isBase64 = Boolean(match[2])
  const data = match[3]
  try {
    if (isBase64) {
      const binary = atob(data)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
      return new Blob([bytes], { type: mime })
    }
    return new Blob([decodeURIComponent(data)], { type: mime })
  } catch {
    return null
  }
}

async function fetchImageBlob(url: string): Promise<Blob | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const blob = await response.blob()
    return blob.size > 0 ? blob : null
  } catch {
    return null
  }
}

function imageElementToBlob(url: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('canvas context unavailable'))
        return
      }
      ctx.drawImage(img, 0, 0)
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('canvas toBlob failed'))
      }, 'image/png')
    }
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`))
    img.src = url
  })
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('读取结果失败'))
    reader.readAsDataURL(blob)
  })
}
