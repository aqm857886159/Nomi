import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const preloadSource = fs.readFileSync(path.join(process.cwd(), 'electron', 'preload.ts'), 'utf8')
const mainSource = fs.readFileSync(path.join(process.cwd(), 'electron', 'main.ts'), 'utf8')
const modelCatalogSource = fs.readFileSync(path.join(process.cwd(), 'electron', 'catalog', 'modelCatalogIpc.ts'), 'utf8')
const assetTransportSource = fs.readFileSync(path.join(process.cwd(), 'electron', 'assetTransportIpc.ts'), 'utf8')
const comfyuiSource = fs.readFileSync(path.join(process.cwd(), 'electron', 'comfyuiIpc.ts'), 'utf8')
const customCallSource = fs.readFileSync(path.join(process.cwd(), 'electron', 'catalog', 'customCallIpc.ts'), 'utf8')

describe('D2 async IPC read paths', () => {
  it('uses invoke for migrated renderer reads and handle for main reads', () => {
    for (const channel of [
      'nomi:model-catalog:vendors:list',
      'nomi:model-catalog:models:list',
      'nomi:model-catalog:mappings:list',
      'nomi:model-catalog:health',
      'nomi:asset-transport:channels:describe',
      'nomi:skill:list',
      'nomi:capability:mcp-info',
      'nomi:model-catalog:comfyui:presets',
      'nomi:model-catalog:custom-call:config:get',
    ]) {
      expect(preloadSource).toMatch(new RegExp(`ipcRenderer\\.invoke\\(\\"${channel}\\"`))
      expect(preloadSource).not.toContain(`invokeSync("${channel}")`)
    }
    expect(mainSource).toContain('registerModelCatalogIpc(registerSyncIpc)')
    expect(modelCatalogSource).toContain('ipcMain.handle("nomi:model-catalog:vendors:list"')
    expect(modelCatalogSource).toContain('ipcMain.handle("nomi:model-catalog:health"')
    expect(assetTransportSource).toContain('ipcMain.handle("nomi:asset-transport:channels:describe"')
    expect(comfyuiSource).toContain('ipcMain.handle("nomi:model-catalog:comfyui:presets"')
    expect(customCallSource).toContain('ipcMain.handle("nomi:model-catalog:custom-call:config:get"')
  })
})
