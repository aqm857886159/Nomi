// 设计实验室 · Agent 面板状态注册表（现役独有形态 · 21 形态表之外）
//
// **这一族状态是 Agent 界面的真相源之一**（2026-09-06 用户拍板：
// UI 交付 = 实验室截图拍板 + 视觉基线绿）。每条注册项带：稳定 id、人话名字、
// 来源文档章节、coverage 档位、以及**用现役组件**渲染的夹具。
//
// 顺序有意义：`labStates.mjs` 按 `states/` 目录名排序解析，
// `agentPanelStates.tsx` 按同样顺序拼接，走查再拿活页面的 `window.__designLabStates`
// 与解析结果逐项比对——三者对不上当场红。加状态时别打乱文件名的数字前缀。
//
// 加一个状态 = 加一条注册项 + 拍板后跑 `pnpm run design-lab:update`。
import React from 'react'
import { InterventionSlot } from '../../../workbench/ai/InterventionSlot'
import {
  ResidentFailureCard,
  ResidentFoldableText,
  ResidentPinnedResultCard,
} from '../../../workbench/ai/resident/ResidentExceptionStates'
import { ResidentThinkingState } from '../../../workbench/ai/resident/ResidentUiPrimitives'
import { hostState, LAB_RECEIPT } from '../agentPanelFixtures'
import { MID_TEXT, NOOP, PieceStage, ShellStage, type LabState } from '../agentPanelKit'

// ── 现役独有形态（21 形态之外，#511/#514 之后长出来的） ───────────────────────

export const LIVE_ONLY_STATES: readonly LabState[] = [
  {
    id: 'live-01-intervention-approval',
    name: '现役 · 介入槽（批准）',
    source: 'InterventionSlot.tsx（#511）· 21 形态表里没有，需补进设计文档',
    coverage: 'component-only',
    render: () => (
      <PieceStage>
        <InterventionSlot
          kind="approval"
          title="要把 5 个画面加进画布"
          summary="加完可以整批撤销"
          effectClass="reversible_local"
          scopeLabel="这一次"
          details={[{ label: '画面', value: '5 个' }]}
          detailsLabel="看看细节"
          onApproveOnce={NOOP}
          onApproveSession={NOOP}
          onReject={NOOP}
          labels={{
            once: '这一次',
            session: '本次会话',
            always: '一直允许',
            reject: '不要',
            rejectPlaceholder: '说说为什么',
            answer: '下一问',
            resolve: '去配置',
            close: '取消',
            scope: '批准范围',
            approve: '批准',
          }}
        />
      </PieceStage>
    ),
  },
  {
    id: 'live-02-intervention-missing',
    name: '现役 · 介入槽（缺凭据）',
    source: 'InterventionSlot.tsx kind=missing_credential',
    coverage: 'component-only',
    render: () => (
      <PieceStage>
        <InterventionSlot
          kind="missing_credential"
          title="还差一个模型密钥"
          summary="配好之后这一步会自己接着跑"
          missingItems={['seedream 4.0 的密钥']}
          onResolveMissing={NOOP}
          onReject={NOOP}
          labels={{
            once: '这一次',
            session: '本次会话',
            always: '一直允许',
            reject: '不要',
            rejectPlaceholder: '说说为什么',
            answer: '下一问',
            resolve: '去配置',
            close: '取消',
            scope: '批准范围',
            approve: '批准',
          }}
        />
      </PieceStage>
    ),
  },
  {
    id: 'live-03-pinned-result',
    name: '现役 · 固定结果卡（细条）',
    source: '§4 v3.1 屏 D 细条 · 现役 ResidentPinnedResultCard',
    coverage: 'component-only',
    render: () => (
      <PieceStage>
        <ResidentPinnedResultCard
          record={LAB_RECEIPT}
          undoLabel="撤销这一笔"
          onUndo={NOOP}
          summaryLabel={(total, selected) => `拆解结果 · ${total} 镜 · 已选 ${selected}`}
          openLabel="展开"
          collapseLabel="收起"
        />
      </PieceStage>
    ),
  },
  {
    id: 'live-04-thinking-primitive',
    name: '现役 · 思考条组件',
    source: 'ResidentUiPrimitives.ResidentThinkingState',
    coverage: 'component-only',
    render: () => (
      <PieceStage>
        <ResidentThinkingState label="正在画分镜" detail="读剧本 → 分段 → 定镜头" open onToggle={NOOP} />
      </PieceStage>
    ),
  },
  {
    id: 'live-05-failure-card',
    name: '现役 · 失败卡（三出路）',
    source: '§4 形态 15 · 现役 ResidentFailureCard',
    coverage: 'component-only',
    render: () => (
      <PieceStage>
        <ResidentFailureCard
          reason="模型这次没回应"
          billing="这次没扣钱"
          actions={['换模型重试', '改提示词', '看详情']}
          onAction={NOOP}
        />
      </PieceStage>
    ),
  },
  {
    id: 'live-07-fold-midlength',
    name: '现役 · 中长文本（262 字，够不着折叠阈值）',
    source: 'ResidentFoldableText 的 `text.length > 360` 阈值 · 设计文档说的是「超过 3 行」',
    coverage: 'component-only',
    render: () => (
      <PieceStage>
        <ResidentFoldableText text={MID_TEXT} expandLabel="还有 N 行" collapseLabel="收起" />
      </PieceStage>
    ),
  },
  {
    id: 'live-06-empty-panel',
    name: '现役 · 空面板（新会话）',
    source: 'ProjectAgentResidentShell 首启态 · 设计文档未画',
    coverage: 'shell',
    render: () => <ShellStage snapshot={hostState({ items: [] })} />,
  },
]
