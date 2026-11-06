// 参数题库跑器的「取证」：从一个项目目录读出这一题的轨迹、草稿计划、画布概况。全部读盘，不信 Agent 自述。
import fs from 'node:fs'
import path from 'node:path'

import { laneMessageText, laneMessages, readLaneTranscripts } from './agent-lane-observer.mjs'
import { annotateRetries, readAlignedCalls } from './askback-trajectory.mjs'

/** `.nomi/runs/<runId>/run.json` 全部读出来（坏文件跳过并记名字）。 */
export function readRunJsons(projectDir) {
  const root = path.join(projectDir, '.nomi', 'runs')
  const runs = []
  const unreadable = []
  if (!fs.existsSync(root)) return { runs, unreadable }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const file = path.join(root, entry.name, 'run.json')
    if (!fs.existsSync(file)) continue
    try { runs.push(JSON.parse(fs.readFileSync(file, 'utf8'))) } catch { unreadable.push(entry.name) }
  }
  return { runs, unreadable }
}

/** 画布概况：节点 id / 种类 / 标题 / 提示词 / meta 键名。只做人读的证据，不进判分。 */
export function readCanvasSummary(projectDir) {
  const file = path.join(projectDir, '.nomi', 'project.json')
  if (!fs.existsSync(file)) return { nodes: [] }
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'))?.payload
  const nodes = Array.isArray(payload?.generationCanvas?.nodes) ? payload.generationCanvas.nodes : []
  return { nodes: nodes.map((node) => ({ id: node.id, kind: node.kind, title: node.title, prompt: node.prompt, status: node.status, metaKeys: Object.keys(node.meta ?? {}) })) }
}

/** 全部助手正文里最后一条非空的；没有返回 ''。 */
export function lastAssistantText(projectDir) {
  let last = ''
  for (const session of readLaneTranscripts(projectDir)) {
    for (const message of laneMessages(session)) {
      if (message.role !== 'assistant') continue
      const text = laneMessageText(message).trim()
      if (text) last = text
    }
  }
  return last
}

/** 一个项目目录里的全部调用，已标好重试序号。 */
export function readAnnotatedCalls(projectDir) {
  return annotateRetries(readAlignedCalls(projectDir))
}
