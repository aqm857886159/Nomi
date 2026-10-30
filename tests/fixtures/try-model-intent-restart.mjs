import process from 'node:process'
import { Buffer } from 'node:buffer'
import Module from 'node:module'
import { require as load } from 'tsx/cjs/api'

// A new process reads only this scenario's disposable settings and fake provider key.
process.env.NOMI_SETTINGS_DIR = process.argv[2]
const original = Module._load
Module._load = function (id, ...args) {
  if (id === 'electron') return {
    app: { getPath: () => process.argv[2], getName: () => 'Nomi', isPackaged: false },
    ipcMain: { on() {}, handle() {}, removeHandler() {} },
    safeStorage: { isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(`enc:${value}`),
      decryptString: value => value.toString().replace(/^enc:/, '') },
  }
  return original.call(this, id, ...args)
}
const { tryModel } = load('../../electron/capabilityCore/modelOnboarding/tryModel.ts', import.meta.url)
const { runTask } = load('../../electron/runtime.ts', import.meta.url)
const result = await tryModel({ runTask, pollTimeoutMs: 2000, approvalPolicy: () => ({ mode: 'direct' }) }, JSON.parse(process.argv[3]))
process.stdout.write(JSON.stringify(result))
