// 参数题库跑器的「取证」：从一个项目目录读出这一题的轨迹、草稿计划、画布概况。全部读盘，不信 Agent 自述。
import fs from 'node:fs'
import path from 'node:path'

import { laneMessageText, laneMessages, readLaneTranscripts } from './agent-lane-observer.mjs'
import { annotateRetries, readAlignedCalls } from './askback-trajectory.mjs'

/** 读原生 run 快照；尚无快照的固定夹具读事件日志末态（坏文件记名字）。 */
export function readRunJsons(projectDir) {
  const root = path.join(projectDir, '.nomi', 'runs')
  const runs = []
  const unreadable = []
  if (!fs.existsSync(root)) return { runs, unreadable }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const file = path.join(root, entry.name, 'run.json')
    const events = path.join(root, entry.name, 'events.ndjson')
    if (!fs.existsSync(file) && !fs.existsSync(events)) continue
    try {
      if (fs.existsSync(file)) runs.push(JSON.parse(fs.readFileSync(file, 'utf8')))
      else {
        const last = fs.readFileSync(events, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).at(-1)
        if (!last?.payload?.run) throw new Error('Missing run in event journal')
        runs.push(last.payload.run)
      }
    } catch { unreadable.push(entry.name) }
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

/** 先切段再标重试，避免预演错误污染测试；userSays 只挂在测试段第一调用。 */
export function taskTrajectory(task, calls, preludeCalls = 0) {
  return [
    ...annotateRetries(calls.slice(0, preludeCalls)).map((call) => ({ ...call, caseId: task.id, phase: 'prelude' })),
    ...annotateRetries(calls.slice(preludeCalls)).map((call, index) => ({ ...call, caseId: task.id, phase: 'test', ...(index === 0 ? { userSays: task.say } : {}) })),
  ]
}
