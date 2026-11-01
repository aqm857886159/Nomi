import { Buffer } from 'node:buffer'
import process from 'node:process'
// Invoked by protocol.test.mjs in a fresh process. Its parent is the mandatory CI test;
// standalone discovery has no persisted receipt and must never manufacture a new task.
import fs from 'node:fs'
import { expect, it, vi } from 'vitest'
import { fetchTaskResult, taskCache } from '../../electron/runtime.ts'
import { listProjectAssets } from '../../electron/assets/projectAssetStore.ts'

vi.mock('electron', async (original) => ({ ...await original(), safeStorage: {
  isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(`test:${s}`), decryptString: (s) => s.toString().replace(/^test:/, ''),
} }))
const inputFile = process.env.NOMI_RELAY_RESTART_INPUT
it.skipIf(!inputFile)('retrieves only the persisted task in the cold process', async () => {
  const { poll, outputFile } = JSON.parse(fs.readFileSync(inputFile, 'utf8'))
  const initialTaskCacheSize = taskCache.size
  expect(initialTaskCacheSize).toBe(0)
  const { result } = await fetchTaskResult(poll)
  expect(result.status).toBe('succeeded')
  expect(result.assets).toHaveLength(1)
  const persisted = listProjectAssets({ projectId: poll.projectId }).items.find((item) => item.data.url === result.assets[0].url)
  expect(persisted?.data.mediaType).toBe('video')
  fs.writeFileSync(outputFile, JSON.stringify({ pid: process.pid, initialTaskCacheSize, result, persistedAssetType: persisted.data.mediaType }))
})
