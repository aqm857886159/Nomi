#!/usr/bin/env node
// 探针 MCP server：**只广播工具、只记录调用，什么都不执行**。
//
// 为什么要它：要量的是「模型看着这份工具面，第一跳选对了没、参数写对了没」。
// 让真实 CLI（Codex / Claude Code）连真 Nomi 需要起整个 app，而 app 的行为会把
// 「工具面好不好读」和「后端好不好用」混成一个数——那就不是这次改动的量尺了。
// 探针只回一个形状正确的信封，让模型能继续往下走一两跳。
//
// 工具定义从 $TOOLFACE_TOOLS_JSON 读（由 dump-tools.ts 生成，逐字节等于 tools/list 广播的那份）。
// 每次 tools/call 追加一行 JSON 到 $TOOLFACE_PROBE_LOG。
import fs from 'node:fs'
import { envelopeFor, worldFor } from './envelope.mjs'

// argv 优先，env 兜底：Codex 与 Claude Code 传 env 给 MCP 子进程的写法不一样，
// argv 是两边都稳的那条路。
const toolsPath = process.argv[2] || process.env.TOOLFACE_TOOLS_JSON
const logPath = process.argv[3] || process.env.TOOLFACE_PROBE_LOG
const WORLD = worldFor(process.argv[4] || process.env.TOOLFACE_STATE || 'S11.6')
if (!toolsPath || !logPath) { process.stderr.write('probe-server: usage: probe-server.mjs <tools.json> <probe-log.jsonl>\n'); process.exit(2) }
const TOOLS = JSON.parse(fs.readFileSync(toolsPath, 'utf8')).map((t) => ({
  name: t.name, description: t.description, inputSchema: t.inputSchema,
  ...(t.annotations ? { annotations: t.annotations } : {}),
}))

let seq = 0
function record(entry) {
  fs.appendFileSync(logPath, `${JSON.stringify({ seq: (seq += 1), at: new Date().toISOString(), ...entry })}\n`)
}

function send(msg) { process.stdout.write(`${JSON.stringify(msg)}\n`) }

let buffer = ''
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    let msg
    try { msg = JSON.parse(line) } catch { continue }
    handle(msg)
  }
})

function handle(msg) {
  const { id, method, params } = msg
  if (method === 'initialize') {
    send({ jsonrpc: '2.0', id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'nomi-tool-face-probe', version: '1.0.0' } } })
    return
  }
  if (method === 'notifications/initialized') return
  if (method === 'tools/list') { send({ jsonrpc: '2.0', id, result: { tools: TOOLS } }); return }
  if (method === 'tools/call') {
    const name = params?.name
    const args = params?.arguments ?? {}
    record({ tool: name, args })
    const known = TOOLS.some((t) => t.name === name)
    if (!known) { send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: `No tool named ${name}` }] } }); return }
    const payload = envelopeFor(name, args, seq, WORLD)
    send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(payload) }] } })
    return
  }
  if (id !== undefined) send({ jsonrpc: '2.0', id, result: {} })
}
