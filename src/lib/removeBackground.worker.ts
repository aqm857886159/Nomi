import { preload, removeBackground as imglyRemoveBackground, type Config } from '@imgly/background-removal'

type WorkerRequest =
  | { id: number; type: 'preload' }
  | { id: number; type: 'remove'; blob: Blob }

type WorkerResponse =
  | { id: number; type: 'done'; blob?: Blob }
  | { id: number; type: 'progress'; key: string; current: number; total: number }
  | { id: number; type: 'error'; error: string }

const workerScope = self as unknown as {
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<WorkerRequest>) => void,
  ) => void
  postMessage: (message: WorkerResponse) => void
}

const BASE_CONFIG: Config = {
  device: 'cpu',
  model: 'isnet_quint8',
  output: {
    format: 'image/png',
    quality: 1,
  },
}

function configForRequest(id: number): Config {
  return {
    ...BASE_CONFIG,
    progress: (key, current, total) => {
      workerScope.postMessage({ id, type: 'progress', key, current, total })
    },
  }
}

async function handleRequest(request: WorkerRequest): Promise<void> {
  try {
    const config = configForRequest(request.id)
    if (request.type === 'preload') {
      await preload(config)
      workerScope.postMessage({ id: request.id, type: 'done' })
      return
    }

    const blob = await imglyRemoveBackground(request.blob, config)
    workerScope.postMessage({ id: request.id, type: 'done', blob })
  } catch (error) {
    workerScope.postMessage({
      id: request.id,
      type: 'error',
      error: error instanceof Error && error.message ? error.message : 'Remove background failed',
    })
  }
}

workerScope.addEventListener('message', (event) => {
  void handleRequest(event.data)
})

export {}
