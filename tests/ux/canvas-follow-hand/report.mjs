// 画布跟手量具 · 两份结果（改前 / 改后）并排成 Markdown 对比表。
// 用法：node tests/ux/canvas-follow-hand/report.mjs <改前.json> <改后.json>
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const get = (o, p) => p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o)
const fmt = (v) => (v == null ? '—' : typeof v === 'number' ? String(Math.round(v * 10) / 10) : String(v))

const ROWS = [
  ['空闲', '挂着的 <video>', 'idle.videosMounted', '0'],
  ['空闲', 'GPU 进程私有内存 MB', 'idle.gpuPrivMB', ''],
  ['空闲', '页面进程私有内存 MB', 'idle.tabPrivMB', ''],
  ['打开项目', '媒体安顿（封面补齐 / 播放器稳定）ms', 'settle.settledMs', ''],
  ['扫过一排视频卡', '输入排队 p99 ms', 'hoverSweep.queueP99', '≤50'],
  ['扫过一排视频卡', '最长帧 ms', 'hoverSweep.maxFrame', '≤50'],
  ['扫过一排视频卡', 'React 提交次数', 'hoverSweep.commits', ''],
  ['扫过一排视频卡', '期间最多挂载 <video>', 'hoverSweep.maxVideosMounted', ''],
  ['停在一张卡上', 'pointerenter → playing ms', 'hoverToPlay.startMs', ''],
  ['悬停相邻两张', '同时在播', 'hoverToPlay.pair.maxPlaying', '≤1'],
  ['悬停过再离开 2 秒', '仍挂着的 <video>', 'hoverToPlay.videosLeftAfterLeave', '0'],
  ['同一张卡再悬停', '能再起播', 'hoverToPlay.replayed', 'true'],
  ['扫过一排后离开 1.5 秒', '仍挂着的 <video>', 'hoverSweep.videosLeftMounted', '0'],
  ['打字 20 字', '按键到画面 中位 ms', 'typing.toPaintMedian', '≤50'],
  ['打字 20 字', '按键到画面 最慢 ms', 'typing.toPaintMax', '≤50'],
  ['打字 20 字', '最长帧 ms', 'typing.maxFrame', '≤50'],
  ['打字', '每键重渲组件', 'typing.renders.perKey', ''],
  ['打字', '· composer', 'typing.renders.perKeyByRegion.composer', ''],
  ['打字', '· 本卡（非 composer）', 'typing.renders.perKeyByRegion.focusNode', ''],
  ['打字', '· canvas-other', 'typing.renders.perKeyByRegion.canvas-other', ''],
  ['打字', '· app-other', 'typing.renders.perKeyByRegion.app-other', ''],
  ['打字', '· nohost', 'typing.renders.perKeyByRegion.nohost', ''],
  ['打字', '· 别的节点（组件数）', 'typing.renders.perKeyByRegion.otherNodes', '0'],
  ['@ 素材（全能参考）', '本次会话第一次 @ 那一帧 ms', 'atMention.coldOpenFrame', '≤50'],
  ['@ 素材（全能参考）', '打 @ 到列表 ms', 'atMention.atToList', '≤100'],
  ['@ 素材', '列表缩略图全部出现 ms', 'atMention.atToThumbs', ''],
  ['@ 素材', '选中到 chip ms', 'atMention.enterToChip', '≤100'],
  ['@ 素材', '选中那一下最长帧 ms', 'atMention.selectFrame', '≤50'],
  ['图生视频下 @ 画布视频 ×10', 'chip 出现（次）', 'atVideoInImageToVideo.chipAppeared', '10'],
  ['图生视频下 @ 画布视频 ×10', '切到参考模式（次）', 'atVideoInImageToVideo.switchedToReference', ''],
  ['图生视频下 @ 画布视频 ×10', '多余连线（条）', 'atVideoInImageToVideo.extraEdges', '0'],
  ['同上·即梦 Seedance（会员）', 'chip 出现（次）', 'atVideoInImageToVideoDreamina.chipAppeared', '10'],
  ['同上·即梦 Seedance（会员）', '切到参考模式（次）', 'atVideoInImageToVideoDreamina.switchedToReference', ''],
  ['同上·即梦 Seedance（会员）', '多余连线（条）', 'atVideoInImageToVideoDreamina.extraEdges', '0'],
  ['时长滑杆', '拖动期间最长帧 ms', 'slider.maxFrame', '≤50'],
  ['时长滑杆', '每步到画面 中位 ms', 'slider.latMedian', '≤50'],
  ['时长滑杆', '每步重渲组件', 'slider.renders.perMove', ''],
  ['时长滑杆', '松手后值落盘（store + 磁盘）', 'slider.persisted', 'true'],
  ['右键新建视频节点', '点击到节点出现 ms', 'create.clickToNode', '≤100'],
  ['右键新建视频节点', '最长帧 ms', 'create.maxFrame', '≤50'],
  ['右键新建视频节点', '连带重渲的别的节点（个）', 'create.renders.otherNodesRerendered', '0'],
  ['拖节点', '每次移动到画面 中位 ms', 'drag.latMedian', '≤50'],
  ['拖节点', '每次移动到画面 最大 ms', 'drag.latMax', '≤50'],
  ['拖节点', '起手最长帧 ms', 'drag.startFrame', '≤50'],
  ['拖节点', '拖动中最长帧 ms', 'drag.maxFrameDuring', '≤50'],
  ['拖节点', '每步重渲组件', 'drag.renders.perMove', ''],
  ['叠放 10 份逐个拖出', '松手后仍跟着鼠标（次 / 总拖动）', null, '0'],
  ['叠放拖出·松手事件丢了', '之后无按键移动仍跟着（次 / 次数）', null, '0'],
  ['方向键 → ×3', '每次 x 位移', null, '每次 +N'],
  ['自动保存', '保存期间界面线程最长阻塞 ms', 'autosave.maxBlock', '≤50'],
]

/** 老结果文件里没有 switchedToReference：从逐次记录里补算（同一口径：换了模式就算切到参考模式）。 */
function normalize(r) {
  for (const key of ['atVideoInImageToVideo', 'atVideoInImageToVideoDreamina']) {
    const x = r.scenarios?.[key]
    if (x?.trials && x.switchedToReference == null) x.switchedToReference = x.trials.filter((t) => t.modeAfter && t.modeAfter !== t.modeBefore).length
  }
  return r
}

function special(row, r) {
  const sc = normalize(r).scenarios || {}
  if (row[2]) return fmt(get(sc, row[2]))
  if (row[0].startsWith('叠放拖出·')) return sc.stackDragOut?.lostRelease ? `${fmt(sc.stackDragOut.lostRelease.stuck)} / ${fmt(sc.stackDragOut.lostRelease.drags)}` : '—'
  if (row[0].startsWith('叠放')) return sc.stackDragOut ? `${fmt(sc.stackDragOut.stuck)} / ${fmt(sc.stackDragOut.normalDrags ?? sc.stackDragOut.drags)}` : '—'
  if (row[0].startsWith('方向键')) return sc.arrowKeys?.deltas ? sc.arrowKeys.deltas.map((d) => `+${d.dx}`).join(' ') : '—'
  return '—'
}

export function formatCompare(before, after) {
  const head = `| 动作 | 指标 | 改前（${before.label} ${before.commit || ''}） | 改后（${after.label} ${after.commit || ''}） | 跟手级预算 |\n|---|---|---|---|---|`
  const lines = ROWS.map((row) => `| ${row[0]} | ${row[1]} | ${special(row, before)} | ${special(row, after)} | ${row[3]} |`)
  return [head, ...lines].join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [a, b] = process.argv.slice(2)
  if (!a || !b) throw new Error('用法：node tests/ux/canvas-follow-hand/report.mjs <改前.json> <改后.json>')
  console.log(formatCompare(JSON.parse(fs.readFileSync(a, 'utf8')), JSON.parse(fs.readFileSync(b, 'utf8'))))
}
