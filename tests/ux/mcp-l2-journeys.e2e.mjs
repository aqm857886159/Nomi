import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { launchNomiApp } from './_launchApp.mjs'
import { makeIsolatedDirs, parseToolResult, spawnMcpStdioClient } from './_mcpJourney.mjs'
import { startFakeApimartServer, writeFakeApimartCatalog } from './_mcpL2Fixture.mjs'

const dirs = makeIsolatedDirs('nomi-mcp-l2-')
const artifactDir = path.join(dirs.tempRoot, 'tests', 'ux', 'mcp-l2')
fs.mkdirSync(artifactDir, { recursive: true })
const trace = (name) => path.join(artifactDir, `${name}.jsonl`)
const screenshotSize = (filePath) => {
  const bytes = fs.readFileSync(filePath)
  assert.equal(bytes.slice(0, 8).toString('hex'), '89504e470d0a1a0a')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes: bytes.length }
}
const takeScreenshot = async (win, name) => {
  const filePath = path.join(artifactDir, `${name}.png`)
  await win.screenshot({ path: filePath })
  const size = screenshotSize(filePath)
  assert.ok(size.width > 0 && size.height > 0 && size.bytes > 0, `${name} screenshot has dimensions`)
}
const resultData = (result) => result?.structuredContent?.nomiRunData || result?.structuredContent?.nomiOutcome || {}
const resultTextJson = (result) => {
  const parsed = parseToolResult(result)
  return parsed.json || resultData(result)
}
const call = async (mcp, name, args, options) => {
  const result = await mcp.callTool(name, args, options)
  if (result?.isError) {
    console.log(`  ${name} error=`, JSON.stringify(result))
    throw new Error(`${name}: ${parseToolResult(result).text}`)
  }
  return result
}

let gui
let provider
let mcp
let passed = 0
const check = (condition, message) => { assert.ok(condition, message); passed += 1; console.log(`  ✓ ${message}`) }

try {
  provider = await startFakeApimartServer({ pendingPolls: 1 })
  writeFakeApimartCatalog(dirs.settingsDir, dirs.userDataDir, provider.origin)
  gui = await launchNomiApp({
    name: 'mcp-l2-journeys', userDataDir: dirs.userDataDir, settingsDir: dirs.settingsDir, projectsDir: dirs.projectsDir,
    env: { NOMI_APP_NAME: 'Nomi', NOMI_CAPABILITY_DIR: dirs.capabilityDir },
    args: ['--disable-gpu', '--disable-software-rasterizer'], settleMs: 0,
  })
  const win = gui.win
  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForFunction(() => window.location.hash.includes('projectId='), undefined, { timeout: 10_000 })
  const projectId = await win.evaluate(() => new URLSearchParams(window.location.hash.split('?')[1] || '').get('projectId'))
  console.log('  GUI hash=', await win.evaluate(() => window.location.hash))
  check(Boolean(projectId), 'GUI 打开隔离项目')
  await win.waitForTimeout(1_000)

  mcp = spawnMcpStdioClient({
    ...dirs, tracePath: trace('C7-C12'), captureStderr: true,
    clientInfo: { name: 'Codex MCP L2', version: 'e2e' }, capabilities: { elicitation: {} },
    env: { NOMI_APP_NAME: 'Nomi' },
  })
  const initialized = await mcp.initialize()
  check(Boolean(initialized?.result), 'C7 initialize 成功')
  const projects = await call(mcp, 'nomi_read', { target: 'projects' })
  const projectsData = resultTextJson(projects)
  console.log('  C7 projects payload=', JSON.stringify({ text: parseToolResult(projects).text, structured: projects.structuredContent }))
  const listedProjects = projectsData.projects || resultData(projects).projects || []
  const listed = listedProjects.find((item) => item.id === projectId) || listedProjects[0]
  check(Boolean(listed?.id), 'C7 nomi_read(projects) 返回当前项目')
  const createdForSession = await call(mcp, 'nomi_project_create', { name: 'C7-C12 real journey' })
  const createdData = resultTextJson(createdForSession)
  const journeyProjectId = createdData.id || resultData(createdForSession).id
  const projectSelectionHandle = createdData.projectSelectionHandle || resultData(createdForSession).projectSelectionHandle
  check(Boolean(journeyProjectId && projectSelectionHandle), 'C7 项目选择句柄来自真实 project_create')
  await win.evaluate((id) => { window.location.hash = `#/studio?projectId=${id}` }, journeyProjectId)
  await win.waitForFunction((id) => window.location.hash.includes(`projectId=${id}`), journeyProjectId, { timeout: 10_000 })
  const opened = await call(mcp, 'nomi_session_open', { projectSelectionHandle })
  const openedData = resultTextJson(opened)
  const leaseHandle = openedData.leaseHandle || resultData(opened).leaseHandle
  check(typeof leaseHandle === 'string' && leaseHandle.length > 20, 'C7 session/open 返回可用 leaseHandle')

  const fourNodes = [0, 1, 2, 3].map((index) => ({ kind: 'shot', title: `镜头 ${index + 1}`, prompt: `湖边纸船镜头 ${index + 1}`, x: index * 380, y: 0 }))
  const declinedClient = spawnMcpStdioClient({ ...dirs, tracePath: trace('C8-decline'), capabilities: { elicitation: {} }, elicitationAction: 'decline', env: { NOMI_APP_NAME: 'Nomi' } })
  await declinedClient.initialize()
  const declined = await call(declinedClient, 'nomi_canvas_edit', { projectId, action: 'add_nodes', nodes: fourNodes })
  const declinedData = resultTextJson(declined)
  console.log('  C8 decline payload=', JSON.stringify({ elicitationCount: declinedClient.elicitationCount(), text: parseToolResult(declined).text, structured: declined.structuredContent }))
  check(declinedData.cancelled === true && declinedData.reason === 'declined', 'C8 elicitation decline 返回 typed reason=declined')
  await declinedClient.terminate()

  const landedClient = spawnMcpStdioClient({ ...dirs, tracePath: trace('C8-land'), capabilities: {}, env: { NOMI_APP_NAME: 'Nomi' } })
  await landedClient.initialize()
  const addPromise = landedClient.callTool('nomi_canvas_edit', { projectId, action: 'add_nodes', nodes: fourNodes })
  const planCard = win.locator('div.fixed.inset-0').filter({ hasText: /在画布落一套方案|落到画布/ }).first()
  await planCard.waitFor({ timeout: 20_000 })
  await takeScreenshot(win, 'C8-four-shots-landed')
  await planCard.locator('button').last().click()
  const landed = await addPromise
  const nodeIds = resultTextJson(landed).ids || resultTextJson(landed).nodeIds || resultData(landed).ids || []
  check(Array.isArray(nodeIds) && nodeIds.length === 4, 'C8 方案确认后四镜真实落画布')
  await landedClient.terminate()
  await mcp.terminate()
  mcp = null
  console.log(`MCP-L2 partial PASS: ${passed} assertions; artifacts=${artifactDir}`)
} catch (error) {
  console.error(error?.stack || error)
  process.exitCode = 1
} finally {
  await mcp?.terminate().catch(() => undefined)
  await provider?.close().catch(() => undefined)
  await gui?.app?.close().catch(() => undefined)
}
