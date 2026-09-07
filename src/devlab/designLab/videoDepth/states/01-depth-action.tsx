// 设计实验室 · 「提取深度」四态（2026-09-07 用户两次拍板后的形态）。
//
// 拍板一：深度视频**不是一种节点**，是视频节点浮条上的一个动作。
// 拍板二（看过第一版接触表之后）：「关于你说的砍 没有问题 其实如果这么砍了之后 也没啥设计的
// 只要保持一致 能挂入参考被模型使用就行」——于是面板、输出三选一、「高级」全部砍掉，
// 点一下就跑。所以这一屏从五态变四态：中间那个「小面板」时刻**不存在了**。
//
// 四格分别钉住一条动线上的四个时刻：
//   ① 选中视频，浮条上找得到这个动作吗（它跟旁边几个动作是不是一伙的）
//   ② 点下去 → 旁边立刻长出一张卡，第一次用要下 47MB，它说人话吗
//   ③ 跑起来的时候，我知道它在看什么吗（进度在顶上，画面留给深度帧）
//   ④ 跑完之后，它像不像一个普通视频节点
// 每格都把**源节点一起截进来**：这一屏最要紧的判断是「这几件东西看着是不是一家的」，
// 只截浮条或只截派生卡都答不了那个问题。
//
// 光暗各一套（`scheme`）：暗色 token 只定义在 `:root[data-mantine-color-scheme="dark"]` 上，
// 组件自己加个 class 翻不动它，所以必须由注册项声明。
//
// 顺序有意义：`labStates.mjs` 按本屏目录里 `NN-*.tsx` 的文件名排序解析，汇总口按同样顺序拼接；
// 接触表两列 → 每一行正好是同一态的光/暗一对。
import React from 'react'

import NodeVideoFrameToolbar from '../../../../workbench/generationCanvas/nodes/NodeVideoFrameToolbar'
import type { GenerationCanvasNode } from '../../../../workbench/generationCanvas/model/generationCanvasTypes'
import {
  DEPTH_ACTION_CELL_WIDTH,
  DEPTH_CARD,
  DepthActionStage,
  DepthDerivationEdge,
  DepthNodeCard,
  DepthProcessingOverlay,
  DEPTH_FRAME,
  SOURCE_FRAME,
} from '../videoDepthLabKit'
import type { LabState } from '../../labScreen'

const NOOP = (): void => {}

const SOURCE_TITLE = '镜头 1 · 推门走进来'
const DERIVED_TITLE = '镜头 1 · 深度'

/** 喂给现役浮条的源节点。真组件读的就是 result.type/url 与 title，所以这里给全。 */
const SOURCE_NODE = {
  kind: 'video',
  title: SOURCE_TITLE,
  position: { x: 0, y: 0 },
  status: 'success',
  categoryId: 'shots',
  result: { id: 'src-r', type: 'video', url: 'nomi-local://asset/demo.mp4', createdAt: 1 },
} as unknown as GenerationCanvasNode

/** 单卡布局（第一格）：卡居中，浮条比卡宽得多，居中才不会被取景框裁掉一头。 */
const SOLO_LEFT = Math.round((DEPTH_ACTION_CELL_WIDTH - DEPTH_CARD.width) / 2)
const SOLO_TOP = 200

/** 双卡布局（二、三、四格）：源 + 派生并排，缝 64（与现役落位规则同一个数）。 */
const PAIR_GAP = 64
const PAIR_LEFT = Math.round((DEPTH_ACTION_CELL_WIDTH - (DEPTH_CARD.width * 2 + PAIR_GAP)) / 2)
const PAIR_RIGHT = PAIR_LEFT + DEPTH_CARD.width + PAIR_GAP

function SoloStage(): JSX.Element {
  return (
    <DepthActionStage>
      <div className="absolute" style={{ left: SOLO_LEFT, top: SOLO_TOP }}>
        <DepthNodeCard
          title={SOURCE_TITLE}
          frame={SOURCE_FRAME}
          selected
          toolbar={
            <NodeVideoFrameToolbar
              node={SOURCE_NODE}
              downloading={false}
              onDownload={NOOP}
              onPreview={NOOP}
              onOpenProvenance={NOOP}
            />
          }
        />
      </div>
    </DepthActionStage>
  )
}

function PairStage({ overlay, derivedFrame }: { overlay?: React.ReactNode; derivedFrame?: string }): JSX.Element {
  return (
    <DepthActionStage>
      <div className="absolute" style={{ left: PAIR_LEFT, top: SOLO_TOP }}>
        <DepthNodeCard title={SOURCE_TITLE} frame={SOURCE_FRAME} />
      </div>
      <DepthDerivationEdge
        left={PAIR_LEFT + DEPTH_CARD.width}
        top={SOLO_TOP + Math.round(DEPTH_CARD.height / 2)}
        width={PAIR_GAP}
      />
      <div className="absolute" style={{ left: PAIR_RIGHT, top: SOLO_TOP }}>
        <DepthNodeCard title={DERIVED_TITLE} frame={derivedFrame} selected>
          {overlay}
        </DepthNodeCard>
      </div>
    </DepthActionStage>
  )
}

const PANEL_SOURCE = '本轮方案 · 「点一下就跑，产物是一张普通视频卡」（2026-09-07 用户两次拍板）'

export const DEPTH_ACTION_STATES: readonly LabState[] = [
  {
    id: 'depth-action-01-toolbar',
    name: '选中视频 · 浮条上多了「提取深度」',
    source: PANEL_SOURCE,
    coverage: 'shell',
    // 这一格要回答的是「这个能力找得到吗、它跟旁边那几个动作是不是一伙的」。
    // 独立节点那一版的答案是「找不到」——它藏在加号菜单的「更多」里，而用户手上明明就有那段片子。
    render: () => <SoloStage />,
  },
  {
    id: 'depth-action-01-toolbar-dark',
    name: '选中视频 · 浮条（暗色）',
    source: PANEL_SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    render: () => <SoloStage />,
  },
  {
    id: 'depth-action-02-downloading',
    name: '第一次用 · 卡已经在了，权重在下',
    source: PANEL_SOURCE,
    coverage: 'shell',
    // 砍掉面板之后这一格回答的是「下载进度去哪了」：它没去别处、更没弹窗，
    // 就在刚长出来那张卡的顶上，和后面的推理进度共用同一条（拍板①：权重不进安装包）。
    // 画面区这时是空的——一帧都还没算出来，画一张假图才是撒谎。
    render: () => (
      <PairStage overlay={<DepthProcessingOverlay percent={38} message="下载模型 47 MB… 38%" />} />
    ),
  },
  {
    id: 'depth-action-02-downloading-dark',
    name: '第一次用 · 下载中（暗色）',
    source: PANEL_SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    render: () => (
      <PairStage overlay={<DepthProcessingOverlay percent={38} message="下载模型 47 MB… 38%" />} />
    ),
  },
  {
    id: 'depth-action-03-processing',
    name: '处理中 · 进度在顶上，画面全是实时深度帧',
    source: PANEL_SOURCE,
    coverage: 'shell',
    // 遮罩里那张灰白的图是**假深度帧**（实验室夹具）。真机上它是 worker 每批回传的最新一帧。
    // 这一格要回答的是：跑分钟级的时候，用户能不能看出「它在看的是我那段片子」——
    // 一根光秃秃的进度条答不了这个问题。
    // 2026-09-07 用户看过第一版后拍板：「把那个放到上面 别遮挡视频」。所以进度环 + 预计剩余 +
    // 取消收成贴着卡顶的一条（§1.5「动作不许压在内容上」），画面区一点不挡；
    // 代价是处理这几分钟里标题胶囊被这一条盖住——真机上同样如此，实验室照着画不粉饰。
    render: () => (
      <PairStage
        overlay={<DepthProcessingOverlay percent={42} message="正在逐帧推理 · 预计还要 1:20" frame={DEPTH_FRAME} />}
      />
    ),
  },
  {
    id: 'depth-action-03-processing-dark',
    name: '处理中（暗色）',
    source: PANEL_SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    render: () => (
      <PairStage
        overlay={<DepthProcessingOverlay percent={42} message="正在逐帧推理 · 预计还要 1:20" frame={DEPTH_FRAME} />}
      />
    ),
  },
  {
    id: 'depth-action-04-done',
    name: '完成 · 它就是一个普通视频节点，标题带出身',
    source: PANEL_SOURCE,
    coverage: 'shell',
    // 跑完之后**没有第三种节点**：它是一段普通视频，能播、能下载、能再抽帧、能拖进任何参考槽。
    // 出身写在标题里（「镜头 1 · 深度」）和那根边上，不需要用户自己记。
    render: () => <PairStage derivedFrame={DEPTH_FRAME} />,
  },
  {
    id: 'depth-action-04-done-dark',
    name: '完成（暗色）',
    source: PANEL_SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    render: () => <PairStage derivedFrame={DEPTH_FRAME} />,
  },
]
