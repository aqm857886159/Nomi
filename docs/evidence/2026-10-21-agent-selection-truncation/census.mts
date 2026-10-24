// 零花费量具：生产构造器 → 生产投影，数「模型收到的文本里到底有几个选中节点」。
// 修前修后各跑一次，对照同一份 N 档；这不是模型分数（模型分数见 probe.mts），只证明投影给了多少信息。
//
//   pnpm exec tsx docs/evidence/2026-10-21-agent-selection-truncation/census.mts [--out <file.json>]
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import * as snapshotModule from '../../../electron/shared/agentContextSnapshot'
import { buildResidentContextSnapshot } from '../../../src/workbench/ai/resident/residentContextSnapshot'

const COUNTS = [1, 12, 16, 24, 40, 256]
const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined }

const rows = COUNTS.map((count) => {
  const ids = Array.from({ length: count }, (_, i) => `gen-v2-image-lw9x${(i + 10).toString(36)}k-ab${(i + 10).toString(36)}z`)
  const titles = ids.map((_, i) => `镜头标题${i + 1}`)
  const snapshot = buildResidentContextSnapshot({
    canvas: { revision: 8, nodes: ids.map((id, i) => ({ id, title: titles[i], kind: 'image' })), selectedNodeIds: ids },
  })
  const text = snapshotModule.formatAgentContextSnapshot(snapshot)
  // `镜头标题1` 是 `镜头标题10` 的前缀，所以按「标题加引号」数。
  const idsInText = ids.filter((id) => text.includes(`"targetId":"${id}"`)).length
  const titlesInText = titles.filter((title) => text.includes(`"title":"${title}"`)).length
  const facts = (snapshotModule as Record<string, unknown>).projectAgentContextSnapshot as undefined | ((s: unknown) => Record<string, unknown>)
  const projection = facts?.(snapshot)
  const statesTotal = /"total":\d+/.test(text) || /共\s*\d+/.test(text)
  return {
    selected: count, nodesNamedInProjection: idsInText, titlesNamedInProjection: titlesInText, chars: text.length,
    silentlyMissing: count - idsInText > 0 && !statesTotal ? count - idsInText : 0,
    ...(projection ? { projection: { total: projection.total, listed: projection.listed, omitted: projection.omitted, truncated: projection.truncated } } : {}),
  }
})
console.log(JSON.stringify(rows, null, 2))
const out = arg('--out')
if (out) { await mkdir(dirname(out), { recursive: true }); await writeFile(out, `${JSON.stringify(rows, null, 2)}\n`) }
