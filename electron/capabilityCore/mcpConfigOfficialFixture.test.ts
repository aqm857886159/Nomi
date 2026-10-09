// R31 · 官方夹具对账：**MCP 官方文档里那份 mcpServers 配置，经过我们的「一键接入」还活着吗。**
//
// 夹具 tests/fixtures/standard-formats/mcp/.mcp.json 是从
// https://modelcontextprotocol.io/docs/develop/connect-local-servers 的 quickstart 原样抄下来的
// filesystem server 样例，出处见 tests/fixtures/standard-formats/SOURCES.md。
//
// 为什么夹具里是别人的 server 而不是我们的：我们自己的条目当然写得进也读得出。
// 真正会出事的是**合并进用户已有配置**时把别人的 server 弄没了——那是「写别人家的文件」这条路上
// 唯一由用户承担后果的失败模式。既有的 mcpConfig.test.ts 用的是手写的 `{ 'cocos-creator': { command: 'x' } }`，
// 形状比官方样例简单得多（没有 args 数组、没有 npx 这类真实字段）。
//
// 门岗 `pnpm run check:standard-formats` 要求登记表里每份夹具都有测试引用它；本文件是 mcp-servers-config 那份的引用方。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let homeDir = ''

vi.mock('electron', () => ({
  app: { getAppPath: () => '/fake/repo', getPath: () => homeDir, get isPackaged() { return false } },
}))
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, default: { ...actual, homedir: () => homeDir }, homedir: () => homeDir }
})

import { installMcp, uninstallMcp } from './mcpConfig'
import { CAPABILITY_DIR_ENV, ensureToken } from './security'

const FIXTURE = 'tests/fixtures/standard-formats/mcp/.mcp.json'
const officialConfig = fs.readFileSync(path.resolve(process.cwd(), FIXTURE), 'utf8')
/** 官方样例里那一条，逐字段留底——断言要比的是它有没有被原样保住。 */
const officialFilesystemEntry = JSON.parse(officialConfig).mcpServers.filesystem as unknown

const roots: string[] = []

beforeEach(() => {
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-official-mcp-'))
  roots.push(homeDir)
  vi.stubEnv(CAPABILITY_DIR_ENV, path.join(homeDir, '.nomi-cap'))
  ensureToken()
})
afterEach(() => {
  vi.stubEnv(CAPABILITY_DIR_ENV, undefined)
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('MCP 官方配置样例（R31 夹具对账）', () => {
  it('一键接入合并进官方样例后，filesystem 那条逐字段原样保留', () => {
    const cursorPath = path.join(homeDir, '.cursor', 'mcp.json')
    fs.mkdirSync(path.dirname(cursorPath), { recursive: true })
    fs.writeFileSync(cursorPath, officialConfig)

    expect(installMcp('cursor').ok).toBe(true)

    const after = JSON.parse(fs.readFileSync(cursorPath, 'utf8'))
    expect(after.mcpServers.filesystem).toEqual(officialFilesystemEntry)
    expect(after.mcpServers.nomi).toBeTruthy()
  })

  it('撤销接入后，官方样例回到一字不差的原样', () => {
    // 「合并而不是覆盖」只讲了一半。另一半是撤销：装了又卸，用户的文件必须回到他给我们之前的样子。
    const cursorPath = path.join(homeDir, '.cursor', 'mcp.json')
    fs.mkdirSync(path.dirname(cursorPath), { recursive: true })
    fs.writeFileSync(cursorPath, officialConfig)

    installMcp('cursor')
    uninstallMcp('cursor')

    const after = JSON.parse(fs.readFileSync(cursorPath, 'utf8'))
    expect(after.mcpServers.nomi).toBeUndefined()
    expect(after.mcpServers.filesystem).toEqual(officialFilesystemEntry)
  })
})
