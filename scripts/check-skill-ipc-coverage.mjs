#!/usr/bin/env node
/**
 * Skill IPC coverage gate — 2026-09-03.
 *
 * 根因：PR #279 交付了渲染层解析和主进程落地函数，但忘了把三个 write IPC handler
 * 注册进 registerSkillIpc，导致整条功能无声失效，CI 全绿。
 *
 * 这个门岗的设计原则：
 *   1. 扫 preload.ts 里 skill 对象内所有 invokeSync("nomi:skill:*") 通道（真相源）。
 *   2. 扫 electron/skills/skillIpc.ts 里 registerSyncIpc("nomi:skill:*") 注册的通道。
 *   3. 差集（preload 有、主进程没注册）必须为零——缺一个就红。
 *
 * 为什么是硬零而不是棘轮：
 *   - 棘轮只关心「总数」，删掉一条合法的再加一条缺失的，计数不变照样绿；
 *   - 这里要的是「每条 preload 通道都有对应注册」，是一一对应关系，只有硬零能保证。
 *
 * 为什么不 import TypeScript：这是一个在 build 之前跑的静态扫描，不依赖编译产物。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const preloadFile = path.join(repoRoot, 'electron', 'preload.ts')
const skillIpcFile = path.join(repoRoot, 'electron', 'skills', 'skillIpc.ts')

function stripLineComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ''))
    .replace(/^[^\S\n]*\/\/.*$/gm, '')
}

/** Extract all 'nomi:skill:*' channels from invokeSync(...) calls in the skill object of preload. */
function extractPreloadSkillChannels(source) {
  // Locate the `skill: {` block in the preload bridge object.
  // We look for invokeSync("nomi:skill:XXX") patterns anywhere in the file (all of them are inside skill:{}).
  const channels = new Set()
  const re = /invokeSync\s*\(\s*["'`](nomi:skill:[^"'`]+)["'`]/g
  let m
  while ((m = re.exec(source)) !== null) {
    channels.add(m[1])
  }
  return channels
}

/** Extract all 'nomi:skill:*' channels from registerSyncIpc(...) calls in skillIpc.ts. */
function extractRegisteredSkillChannels(source) {
  const channels = new Set()
  const re = /registerSyncIpc\s*\(\s*["'`](nomi:skill:[^"'`]+)["'`]/g
  let m
  while ((m = re.exec(source)) !== null) {
    channels.add(m[1])
  }
  return channels
}

if (!fs.existsSync(preloadFile)) {
  console.error(`✖ preload.ts not found: ${preloadFile}`)
  process.exit(1)
}
if (!fs.existsSync(skillIpcFile)) {
  console.error(`✖ skillIpc.ts not found: ${skillIpcFile}`)
  process.exit(1)
}

const preloadSrc = stripLineComments(fs.readFileSync(preloadFile, 'utf8'))
const skillIpcSrc = stripLineComments(fs.readFileSync(skillIpcFile, 'utf8'))

const preloadChannels = extractPreloadSkillChannels(preloadSrc)
const registeredChannels = extractRegisteredSkillChannels(skillIpcSrc)

// Guard 1: every preload nomi:skill:* channel must have a corresponding registerSyncIpc in skillIpc.ts
const missing = [...preloadChannels].filter((ch) => !registeredChannels.has(ch))

// Guard 2: no nomi:skill:* channel in preload may use ipcRenderer.invoke (all must be invokeSync)
const asyncSkillChannels = []
const asyncRe = /ipcRenderer\.invoke\s*\(\s*["'`](nomi:skill:[^"'`]+)["'`]/g
let am
while ((am = asyncRe.exec(preloadSrc)) !== null) {
  asyncSkillChannels.push(am[1])
}

let failed = false

if (missing.length > 0) {
  failed = true
  console.log('\n✖ Skill IPC coverage: preload 声明了但主进程没有注册的通道:')
  for (const ch of missing) {
    console.log(`    "${ch}"  — 在 electron/skills/skillIpc.ts 的 registerSkillIpc 里补上 registerSyncIpc("${ch}", handler)`)
  }
  console.log()
  console.log('  后果：渲染层调用返回 "No handler registered for \'...\'"，UI 静默失败（P0 体验断点）。')
  console.log('  这正是 2026-09-03 走查发现的根因：nomi:skill:import/export/delete 三条全缺。')
}

if (asyncSkillChannels.length > 0) {
  failed = true
  console.log('\n✖ Skill IPC 协议混用: 以下 nomi:skill:* 通道在 preload 里用了 ipcRenderer.invoke（async），')
  console.log('  但 skillIpc.ts 里注册的是 registerSyncIpc（sync）——协议不对齐，渲染层拿到 Promise 而非结果:')
  for (const ch of asyncSkillChannels) {
    console.log(`    "${ch}"  → 改成 invokeSync("${ch}", ...)`)
  }
}

if (failed) {
  console.log('\n[check:skill-ipc-coverage] 未通过。')
  process.exit(1)
}

console.log(`✅ Skill IPC coverage: preload 声明的通道（${[...preloadChannels].join(', ')}）在主进程全部有注册，协议一致（全 invokeSync）。`)
