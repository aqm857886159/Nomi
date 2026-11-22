import type { LabState } from '../../labScreen'
import {
  L, LabCanvasBackdrop, LabCanvasNode, LabCanvasZoomed, LabCaption, LabCardRow, LabChatPanel, NodePointer, NodePointerGroup,
  NodePointerReturnToChat, NodePointerStage, NomiEntryPreview, subjects, type Locale,
} from '../nodePointerLabKit'
import { LabCanvasViewport } from '../../labCanvasViewport'

const SOURCE = 'docs/design/boards/2026-10-23/NodePointer.board.json'
// 第②步只在实验室搭全状态，聊天里还没有宿主（第③步新付费卡接线）：全部格子都是「组件在、界面走不到」（component-only）。
const SENTENCE = (locale: Locale) => L(locale, '已在画布上起草了 3 个镜头。想改哪个，点它。', 'Drafted 3 shots on the canvas. Click one to edit it.')

/** A2 / A5 的主体：P1 六态 + 板外的节点态、组指向、P2 行与句中标签。英文 / 暗色格子复用这一块。 */
function StatesBoard({ locale }: { locale: Locale }) {
  const s = subjects(locale)
  return (
    <div className="flex flex-col gap-5">
      <LabCardRow items={[
        { caption: L(locale, '等你确认', 'Waiting'), subject: s.await },
        { caption: L(locale, '排队', 'Queued'), subject: s.queued },
        { caption: L(locale, '生成中', 'Generating'), subject: s.gen },
        { caption: L(locale, '完成', 'Done'), subject: s.done },
        { caption: L(locale, '失败', 'Failed'), subject: s.failed },
        { caption: L(locale, '已删除（不可点）', 'Deleted (not clickable)'), subject: s.deleted },
      ]} />
      <div className="flex items-start gap-8">
        <div className="flex flex-col" style={{ width: 360 }}>
          <LabCaption>{L(locale, '组指向 · 混合状态', 'Group · mixed states')}</LabCaption>
          <NodePointerGroup subjects={s.mixed} />
        </div>
        <div className="flex flex-col" style={{ width: 360 }}>
          <LabCaption>{L(locale, '5 个镜头：露 3 格，第 3 格盖「还有 2 个」', '5 shots: 3 tiles, the 3rd says “2 more”')}</LabCaption>
          <NodePointerGroup subjects={s.five} />
        </div>
        <div className="flex flex-col" style={{ width: 380 }}>
          <LabCaption>{L(locale, 'P2 · 句中小标签', 'P2 · inline chips')}</LabCaption>
          <p className="m-0 text-body-sm leading-8 text-nomi-ink">{L(locale, '已起草 3 个镜头：', 'Drafted 3 shots: ')}<NodePointerGroup subjects={s.mixed} density="chip" /></p>
          <p className="m-0 text-body-sm leading-8 text-nomi-ink"><NodePointerGroup subjects={s.five} density="chip" /></p>
        </div>
      </div>
      <div className="flex items-start gap-8">
        <div className="flex flex-col" style={{ width: 360 }}>
          <LabCaption>{L(locale, 'P2 · 列表行', 'P2 · list rows')}</LabCaption>
          <NodePointerGroup subjects={[s.done, s.gen, s.failed, s.deleted]} density="row" />
        </div>
        <div className="flex flex-col" style={{ width: 360 }}>
          <LabCaption>{L(locale, '竖版：槽高固定、真比例居中', 'Vertical: fixed slot, true ratio centred')}</LabCaption>
          <NodePointerGroup subjects={s.portraitMix} />
        </div>
        <div className="flex flex-col" style={{ width: 260 }}>
          <LabCaption>{L(locale, '单个竖版：摘要两行', 'Single vertical: two-line summary')}</LabCaption>
          <NodePointer subject={s.tall} />
        </div>
      </div>
    </div>
  )
}

/** A3：悬停两边同时亮 / 点击后画布闪一下、那一项「已定位」。画布节点是生产 BaseGenerationNode。 */
function LinkBoard({ locale, located = false }: { locale: Locale; located?: boolean }) {
  const s = subjects(locale)
  const zoom = 0.45
  const boardScale = 240 / 112
  const shotLefts = [24, 156, 288].map((left) => left * boardScale)
  const shotTop = 100 * boardScale - 72
  const controlLeft = 156 * boardScale
  const controlTop = 214 * boardScale - 72
  const canvasNodes = (flash: boolean) => (
    <div className="absolute left-0 top-0" style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
      <LabCanvasViewport zoom={zoom}>
        {s.drafts.map((subject, index) => <div key={subject.nodeId} className="absolute" style={{ left: shotLefts[index], top: shotTop }}><LabCanvasNode nodeId={subject.nodeId} width={240} flash={flash && index === 1} /></div>)}
        <div className="absolute" style={{ left: controlLeft, top: controlTop }}><LabCanvasNode nodeId="np-control" width={240} /></div>
      </LabCanvasViewport>
    </div>
  )
  return (
    <div className="flex flex-col gap-4">
      <div data-link-board-half="p1" className="flex items-stretch gap-0">
        <LabCanvasBackdrop className="link-board-canvas flex-1 rounded-r-none" style={{ height: 300 }}>
          {canvasNodes(located)}
        </LabCanvasBackdrop>
        <LabChatPanel text={SENTENCE(locale)} className="rounded-l-none border-l-0 shadow-none">
          <div data-lab-hover="p1"><NodePointerGroup subjects={s.drafts} /></div>
        </LabChatPanel>
      </div>
      <div data-link-board-half="p2" className="flex items-stretch gap-0">
        <LabCanvasBackdrop className="link-board-canvas flex-1 rounded-r-none" style={{ height: 300 }}>
          {canvasNodes(located)}
        </LabCanvasBackdrop>
        <LabChatPanel text={SENTENCE(locale)} className="rounded-l-none border-l-0 shadow-none">
          <div data-lab-hover="p2"><NodePointerGroup subjects={s.drafts} density="row" /></div>
        </LabChatPanel>
      </div>
    </div>
  )
}

/** A4：窄窗口三步——对话盖住画布 / 点了以后对话收进顶栏 Nomi 入口、画布露出并闪一下、底部「回到对话」 / 回来后那一项「已定位」。 */
function NarrowBoard({ locale }: { locale: Locale }) {
  const s = subjects(locale)
  const frame = { width: 380, height: 520 }
  return (
    <div className="flex items-start gap-6">
      <div>
        <LabCaption>{L(locale, '① 对话浮在画布上，画布被盖住大半', '① Chat floats over the canvas')}</LabCaption>
        <LabCanvasBackdrop style={frame}>
          <LabCanvasZoomed zoom={0.42} className="left-4 top-4"><div className="flex gap-6">{s.narrowDrafts.map((subject) => <LabCanvasNode key={subject.nodeId} nodeId={subject.nodeId} width={240} />)}</div></LabCanvasZoomed>
          <LabChatPanel text={SENTENCE(locale)} width={356} className="absolute bottom-3 left-3"><NodePointerGroup subjects={s.narrowDrafts} /></LabChatPanel>
        </LabCanvasBackdrop>
      </div>
      <div>
        <LabCaption>{L(locale, '② 点镜 02：对话收进顶栏入口，画布露出并闪一下目标', '② Click Shot 02: chat collapses, the target flashes')}</LabCaption>
        <LabCanvasBackdrop style={frame}>
          <div className="absolute left-[100px] top-[150px]"><LabCanvasNode nodeId="np-draft-2" width={180} flash /></div>
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2"><NodePointerReturnToChat /></div>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2"><NodePointerReturnToChat withLabel /></div>
          {/* 收起的面板只从顶栏最右那颗入口叫回（NomiEntryTopbar 板）：取景框右上角代表顶栏那一格。 */}
          <NomiEntryPreview status={null} face={null} pendingCount={0} unread={0} open={false} roomy className="absolute right-2 top-2" />
        </LabCanvasBackdrop>
      </div>
      <div>
        <LabCaption>{L(locale, '③ 回到对话：对话原样回来，镜 02 标着「已定位」', '③ Back to chat: Shot 02 stays “Located”')}</LabCaption>
        <LabCanvasBackdrop style={frame}>
          <LabCanvasZoomed zoom={0.42} className="left-4 top-4"><div className="flex gap-6">{s.drafts.map((subject) => <LabCanvasNode key={subject.nodeId} nodeId={subject.nodeId} width={240} />)}</div></LabCanvasZoomed>
          <LabChatPanel text={SENTENCE(locale)} width={356} className="absolute bottom-3 left-3">
            <NodePointerGroup subjects={s.drafts} />
            <NodePointerGroup subjects={s.drafts} density="row" />
          </LabChatPanel>
        </LabCanvasBackdrop>
      </div>
    </div>
  )
}

const HOVER_TARGETS = ['[data-lab-hover="p1"] [data-node-pointer-id="np-draft-2"]', '[data-lab-hover="p2"] [data-node-pointer-id="np-draft-2"]'] as const

const narrowReturn = (locale: Locale) => ({ nodeId: 'np-draft-2', label: L(locale, '镜 02', 'Shot 02') })

export const NODE_POINTER_STATES: readonly LabState[] = [
  {
    id: 'np-anatomy',
    name: 'A1 一张脸：画布上的真节点 ↔ 聊天里的 P1 / P2',
    source: SOURCE,
    coverage: 'component-only',
    render: () => (
      <NodePointerStage>
        <div className="flex flex-col gap-6">
          <div>
            <LabCaption>画布上的节点（生产 BaseGenerationNode）：等你确认 · 生成中 · 完成</LabCaption>
            <div className="flex gap-8">{['np-await', 'np-gen', 'np-done'].map((nodeId) => <LabCanvasNode key={nodeId} nodeId={nodeId} width={220} />)}</div>
          </div>
          <div className="flex items-start gap-10">
            <div>
              <LabCaption>聊天里的 P1（同样大小、同样排法；状态条落进缩略图里）</LabCaption>
              <div className="flex gap-8">{['np-await', 'np-gen', 'np-done'].map((nodeId) => <div key={nodeId} style={{ width: 220 }}><NodePointer subject={{ nodeId }} /></div>)}</div>
            </div>
            <div style={{ width: 300 }}>
              <LabCaption>P2 行内形态（同一个零件的窄密度）</LabCaption>
              <NodePointerGroup subjects={[{ nodeId: 'np-await' }, { nodeId: 'np-gen' }, { nodeId: 'np-done' }]} density="row" />
            </div>
          </div>
        </div>
      </NodePointerStage>
    ),
  },
  {
    id: 'np-p1-states',
    name: 'A2 P1 六态 + 板外节点态（占位 / 已停 / 可找回 / 长名字）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => {
      const s = subjects('zh-CN')
      return (
        <NodePointerStage>
          <div className="flex flex-col gap-6">
            <LabCardRow items={[
              { caption: '等你确认', subject: s.await },
              { caption: '排队', subject: s.queued },
              { caption: '生成中', subject: s.gen },
              { caption: '完成（结果缩略图）', subject: s.done },
              { caption: '失败（宿主给结局）', subject: s.failed },
              { caption: '已删除（不可点）', subject: s.deleted },
            ]} />
            <LabCardRow items={[
              { caption: '节点不在、宿主没说删：占位（D4）', subject: s.unavailable },
              { caption: '制作已停（节点同一句）', subject: s.stopped },
              { caption: '可找回', subject: s.recoverable },
              { caption: '长名字截断，全名靠悬停', subject: s.long },
            ]} />
          </div>
        </NodePointerStage>
      )
    },
  },
  {
    id: 'np-groups',
    name: 'A2 组指向：3 个草稿 / 混合 / 5 个折叠 / 4 个也折 / 横竖混排 / 单个竖版',
    source: SOURCE,
    coverage: 'component-only',
    render: () => {
      const s = subjects('zh-CN')
      return (
        <NodePointerStage>
          <div className="grid grid-cols-3 gap-x-8 gap-y-6">
            <div><LabCaption>3 个镜头 · 全是草稿</LabCaption><NodePointerGroup subjects={s.drafts} /></div>
            <div><LabCaption>混合状态：完成 · 生成中 · 失败</LabCaption><NodePointerGroup subjects={s.mixed} /></div>
            <div><LabCaption>5 个镜头：第 3 格盖「还有 2 个」，点它展开</LabCaption><NodePointerGroup subjects={s.five} /></div>
            <div><LabCaption>4 个镜头也折（超过 3 个）</LabCaption><NodePointerGroup subjects={s.four} /></div>
            <div><LabCaption>一组里横竖混排：槽高固定，竖版真比例居中</LabCaption><NodePointerGroup subjects={s.portraitMix} /></div>
            <div><LabCaption>单个竖版：宽度不变，摘要两行带 9:16</LabCaption><div style={{ width: 300 }}><NodePointer subject={s.tall} /></div></div>
          </div>
        </NodePointerStage>
      )
    },
  },
  {
    id: 'np-p2',
    name: 'A2 P2 行内形态：列表行六态 + 句中小标签（3 个 / 5 个折「+2」）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => {
      const s = subjects('zh-CN')
      return (
        <NodePointerStage scene={{ located: 'np-done' }}>
          <div className="flex items-start gap-10">
            <div style={{ width: 360 }}>
              <LabCaption>列表行：等你确认 · 排队 · 生成中 · 完成（已定位）· 失败 · 已删除</LabCaption>
              <NodePointerGroup subjects={[s.await, s.queued, s.gen, s.done, s.failed, s.deleted]} density="row" />
            </div>
            <div className="flex flex-col gap-4" style={{ width: 420 }}>
              <LabCaption>句中小标签：嵌在 Agent 的话里自然折行</LabCaption>
              <p className="m-0 text-body-sm leading-8 text-nomi-ink">已在画布上起草了 3 个镜头：<NodePointerGroup subjects={s.drafts} density="chip" /></p>
              <p className="m-0 text-body-sm leading-8 text-nomi-ink">5 个镜头：<NodePointerGroup subjects={s.five} density="chip" /></p>
              <p className="m-0 text-body-sm leading-8 text-nomi-ink">混合：<NodePointerGroup subjects={[s.done, s.gen, s.failed, s.deleted]} density="chip" /></p>
            </div>
          </div>
        </NodePointerStage>
      )
    },
  },
  {
    id: 'np-hover',
    name: 'A3 ① 悬停镜 02：两边同时亮（中性深色细线，不用蓝）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => (
      <NodePointerStage scene={{ hover: HOVER_TARGETS }}>
        <LinkBoard locale="zh-CN" />
      </NodePointerStage>
    ),
  },
  {
    id: 'np-located',
    name: 'A3 ② 点击：画布滑到镜 02 闪一下（ink 淡光晕），那一项「已定位」',
    source: SOURCE,
    coverage: 'component-only',
    render: () => (
      <NodePointerStage scene={{ located: 'np-draft-2' }}>
        <LinkBoard locale="zh-CN" located />
      </NodePointerStage>
    ),
  },
  {
    id: 'np-narrow',
    name: 'A4 窄窗口：收进顶栏入口 → 画布闪一下 → 回到对话（P1 / P2 两种按钮）→ 已定位',
    source: SOURCE,
    coverage: 'component-only',
    render: () => (
      <NodePointerStage scene={{ located: 'np-draft-2', returnTo: narrowReturn('zh-CN') }}>
        <NarrowBoard locale="zh-CN" />
      </NodePointerStage>
    ),
  },
  {
    id: 'np-en',
    name: 'A5 英文 · 光',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <NodePointerStage locale="en" scene={{ located: 'np-done' }}><StatesBoard locale="en" /></NodePointerStage>,
  },
  {
    id: 'np-dark',
    name: 'A5 中文 · 暗',
    source: SOURCE,
    coverage: 'component-only',
    scheme: 'dark',
    render: () => <NodePointerStage scene={{ located: 'np-done' }}><StatesBoard locale="zh-CN" /></NodePointerStage>,
  },
  {
    id: 'np-en-dark',
    name: 'A5 英文 · 暗',
    source: SOURCE,
    coverage: 'component-only',
    scheme: 'dark',
    render: () => <NodePointerStage locale="en" scene={{ located: 'np-done' }}><StatesBoard locale="en" /></NodePointerStage>,
  },
  {
    id: 'np-hover-en-dark',
    name: 'A3 悬停联动 · 英文 · 暗',
    source: SOURCE,
    coverage: 'component-only',
    scheme: 'dark',
    render: () => (
      <NodePointerStage locale="en" scene={{ hover: HOVER_TARGETS }}>
        <LinkBoard locale="en" />
      </NodePointerStage>
    ),
  },
  {
    id: 'np-narrow-en-dark',
    name: 'A4 窄窗口 · 英文 · 暗',
    source: SOURCE,
    coverage: 'component-only',
    scheme: 'dark',
    render: () => (
      <NodePointerStage locale="en" scene={{ located: 'np-draft-2', returnTo: narrowReturn('en') }}>
        <NarrowBoard locale="en" />
      </NodePointerStage>
    ),
  },
]
