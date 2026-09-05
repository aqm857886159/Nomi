// 设计实验室 · Agent 面板状态注册表（21 形态 · 设计定稿 §4）
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
import { StaleConversationDivider } from '../../../workbench/ai/staleConversationDivider'
import {
  ResidentArtifactCard,
  ResidentAtPicker,
  ResidentCandidatesCard,
  ResidentDeviationCard,
  ResidentQuestionCard,
  ResidentSpendCard,
} from '../../../workbench/ai/resident/ResidentExceptionStates'
import {
  assistantItem,
  failureItem,
  hostState,
  LAB_RECEIPT,
  proposalItem,
  queueItem,
  toolItem,
  userItem,
} from '../agentPanelFixtures'
import {
  LAB_ASSETS,
  MissingStage,
  NOOP,
  PieceStage,
  planCard,
  PLAN_SHOTS,
  ShellStage,
  type LabState,
} from '../agentPanelKit'

// ── 21 形态（设计定稿 §4） ────────────────────────────────────────────────────

export const FORM_STATES: readonly LabState[] = [
  {
    id: 'form-01-usage',
    name: '形态 1 · 上下文用量',
    source: '2026-09-01-agent-ui-final-redesign.md §4 形态 1（v3 头部收成一行）',
    coverage: 'shell',
    render: () => <ShellStage snapshot={hostState({ items: [userItem('把剧本拆成分镜')] })} />,
  },
  {
    id: 'form-02-compaction',
    name: '形态 2 · 压缩分隔线',
    source: '§4 形态 2 · 现役近邻 staleConversationDivider.tsx',
    coverage: 'component-only',
    render: () => (
      <PieceStage>
        <StaleConversationDivider />
      </PieceStage>
    ),
  },
  {
    id: 'form-03-user-bubble',
    name: '形态 3 · 用户气泡',
    source: '§4 形态 3',
    coverage: 'shell',
    render: () => <ShellStage snapshot={hostState({ items: [userItem('把剧本拆成分镜，先给我五个镜头')] })} />,
  },
  {
    id: 'form-04-thinking-running',
    name: '形态 4 · 思考条（进行中）',
    source: '§4 形态 4',
    coverage: 'shell',
    render: () => (
      <ShellStage
        snapshot={hostState({ turnStatus: 'running', items: [userItem('把剧本拆成分镜')] })}
      />
    ),
  },
  {
    id: 'form-04b-thinking-settled',
    name: '形态 4b · 思考条（落定态）',
    source: '§4 形态 4「结束原位落定成结果句不消失」',
    coverage: 'missing',
    render: () => <MissingStage what="思考条结束后落定成结果句（现役 planning 结束即消失）" />,
  },
  {
    id: 'form-05-stage-line',
    name: '形态 5 · 阶段分隔线',
    source: '§4 形态 5',
    coverage: 'missing',
    render: () => <MissingStage what="「进入 · 生产段」阶段线 + 工序图示" />,
  },
  {
    id: 'form-06-tool-line',
    name: '形态 6 · 工具条（完成收拢）',
    source: '§4 形态 6（v3 整改⑤：一行 + 行尾 ▾）',
    coverage: 'shell',
    render: () => (
      <ShellStage
        snapshot={hostState({
          items: [
            userItem('把剧本拆成分镜'),
            toolItem('read_document', 'done', { itemId: 'lab-tool-1' }),
            toolItem('storyboard_plan', 'done', { itemId: 'lab-tool-2' }),
            assistantItem('拆成 5 镜，其中 2 镜需要站位参考。'),
          ],
        })}
      />
    ),
  },
  {
    id: 'form-07-reply',
    name: '形态 7 · 普通回复',
    source: '§4 形态 7',
    coverage: 'shell',
    render: () => (
      <ShellStage
        snapshot={hostState({
          items: [userItem('这段该怎么拍？'), assistantItem('贴着人物跑，中段做一次急转，结尾停在雨幕特写。')],
        })}
      />
    ),
  },
  {
    id: 'form-08-plan-card',
    name: '形态 8 · 计划卡',
    source: '§4 形态 8 · 现役 ResidentPlanCard',
    coverage: 'component-only',
    render: () => <PieceStage>{planCard('ready', PLAN_SHOTS)}</PieceStage>,
  },
  {
    id: 'form-09-spend-card',
    name: '形态 9 · 付费确认卡',
    source: '§4 形态 9 · 现役 ResidentSpendCard',
    coverage: 'component-only',
    render: () => (
      <PieceStage>
        <ResidentSpendCard
          knownRows={[
            { label: '镜数', value: '5 镜' },
            { label: '模型', value: 'seedream 4.0' },
          ]}
          amount={12.5}
          failureReason="合计"
          refreshLabel="重新获取价格"
          continueLabel="仍要生成"
          onRefresh={NOOP}
          onContinue={NOOP}
          amountLabel={(amount) => `¥${amount.toFixed(2)}`}
          unknownAmountLabel="暂时无法获取"
        />
      </PieceStage>
    ),
  },
  {
    id: 'form-10-receipt',
    name: '形态 10 · 写入回执 + 撤销',
    source: '§4 形态 10（护城河）',
    coverage: 'shell',
    render: () => (
      <ShellStage
        receipt={LAB_RECEIPT}
        snapshot={hostState({
          items: [userItem('把这五镜加进画布'), proposalItem('done', { itemId: 'lab-proposal-item' })],
        })}
      />
    ),
  },
  {
    id: 'form-11-queue-one',
    name: '形态 11 · 排队（一条）',
    source: '§4 形态 11',
    coverage: 'shell',
    render: () => (
      <ShellStage
        snapshot={hostState({
          turnStatus: 'running',
          items: [userItem('先把第一批生出来')],
          queue: [queueItem('q1', 'queued')],
        })}
      />
    ),
  },
  {
    id: 'form-12-progress',
    name: '形态 12 · 进度条目（原位更新）',
    source: '§4 形态 12',
    coverage: 'shell',
    render: () => (
      <ShellStage
        snapshot={hostState({
          turnStatus: 'running',
          items: [userItem('批量生图'), toolItem('generate_image', 'running', { itemId: 'lab-tool-run' })],
        })}
      />
    ),
  },
  {
    id: 'form-13-artifact-card',
    name: '形态 13 · 产物缩略卡（现役只有 loading/failed 两态）',
    source: '§4 形态 13 · 现役 ResidentArtifactCard',
    coverage: 'component-only',
    render: () => (
      <PieceStage>
        <ResidentArtifactCard
          state="ready"
          title="镜 2 追逐起步"
          sizeLabel="1920×1080"
          versionLabel="第 1 版"
          waitLabel="已等 0:12，通常需要 30–60 秒"
          failureReason="生成失败"
          billing="这次没扣钱"
          retryLabel="重试"
          editLabel="改提示词"
          openLabel="去画布"
          onRetry={NOOP}
          onEdit={NOOP}
          onOpen={NOOP}
        />
      </PieceStage>
    ),
  },
  {
    id: 'form-14-candidates',
    name: '形态 14 · 多候选组',
    source: '§4 形态 14 · 现役 ResidentCandidatesCard',
    coverage: 'component-only',
    render: () => (
      <PieceStage>
        <ResidentCandidatesCard
          candidates={[
            { id: 'a', label: 'A 版' },
            { id: 'b', label: 'B 版' },
            { id: 'c', label: 'C 版' },
          ]}
          versionCountLabel={(count) => `${count} 版候选`}
          adoptLabel={(label) => `采用 ${label}`}
          moreLabel="+2"
          collapseLabel="收起"
          onSelect={NOOP}
        />
      </PieceStage>
    ),
  },
  {
    id: 'form-15-failure',
    name: '形态 15 · 失败条',
    source: '§4 形态 15',
    coverage: 'shell',
    render: () => (
      <ShellStage
        snapshot={hostState({
          items: [
            userItem('生成镜 3'),
            failureItem('provider_timeout', '模型这次没回应，任务停在第 3 镜'),
          ],
        })}
      />
    ),
  },
  {
    id: 'form-16-deviation',
    name: '形态 16 · 有出入卡',
    source: '§4 形态 16（Nomi 独有护城河）· 现役 ResidentDeviationCard',
    coverage: 'component-only',
    render: () => (
      <PieceStage>
        <ResidentDeviationCard
          deviations={[
            { where: '镜 2', field: '画幅', detail: '要的是 16:9，出来的是 4:3' },
            { where: '镜 4', field: '人物', detail: '雨衣颜色和定妆照对不上' },
          ]}
          moreLabel="有 2 处和你要的不一样"
          collapseLabel="收起"
          actions={['让 AI 修', '撤销这一步', '知道了']}
          onAction={NOOP}
        />
      </PieceStage>
    ),
  },
  {
    id: 'form-17-question',
    name: '形态 17 · 反问卡',
    source: '§4 形态 17 · 现役 ResidentQuestionCard',
    coverage: 'component-only',
    render: () => (
      <PieceStage>
        <ResidentQuestionCard
          question="这段追逐你想要哪种气质？"
          options={[
            { id: 'a', label: '冷冽写实' },
            { id: 'b', label: '霓虹赛博' },
            { id: 'c', label: '黑白硬派' },
          ]}
          pageLabel="1 / 2"
          moreLabel="展开"
          collapseLabel="收起"
          skipLabel="跳过"
          nextLabel="下一问"
          onAnswer={NOOP}
          onSkip={NOOP}
          onNext={NOOP}
        />
      </PieceStage>
    ),
  },
  {
    id: 'form-18-queue-list',
    name: '形态 18 · 指令队列（多条）',
    source: '§4 形态 18（v3 整改④：消息排队贴输入框上沿）',
    coverage: 'shell',
    render: () => (
      <ShellStage
        snapshot={hostState({
          turnStatus: 'running',
          items: [userItem('先把第一批生出来')],
          queue: [queueItem('q1', 'queued'), queueItem('q2', 'queued'), queueItem('q3', 'queued')],
        })}
      />
    ),
  },
  {
    id: 'form-19-at-picker',
    name: '形态 19 · @ 选择器',
    source: '§4 形态 19（v3：chip 取消，引用走 @）· 现役 ResidentAtPicker',
    coverage: 'component-only',
    render: () => (
      <PieceStage>
        <ResidentAtPicker
          assets={LAB_ASSETS.slice(0, 4)}
          groups={[{ label: '技能', items: [{ id: 'k', label: '编剧·Kasdan 方法论' }] }]}
          emptyTitle="这个项目还没有素材"
          emptyDescription="先上传一张参考图或定妆照"
          uploadLabel="去上传素材"
          searchLabel="搜索素材"
          onPickAsset={NOOP}
          onUpload={NOOP}
        />
      </PieceStage>
    ),
  },
  {
    id: 'form-20-skill-event',
    name: '形态 20 · 技能载入条',
    source: '§4 形态 20（v3 整改②：技能在 UI 的唯一呈现）',
    coverage: 'shell',
    render: () => (
      <ShellStage
        snapshot={hostState({
          items: [
            userItem('按 Kasdan 的方法拆这段'),
            toolItem('skill.read', 'done', { itemId: 'lab-skill', skill: '编剧·Kasdan' }),
            assistantItem('好，按三幕推进来拆。'),
          ],
        })}
      />
    ),
  },
  {
    id: 'form-21-skill-badge-retired',
    name: '形态 21 · 常驻技能标记（已取消）',
    source: '§4 形态 21 · v3 整改①②取消；基线钉死「头部没有技能 pill」',
    coverage: 'retired',
    render: () => (
      <ShellStage
        snapshot={hostState({
          items: [toolItem('skill.read', 'done', { itemId: 'lab-skill-2', skill: '编剧·Kasdan' })],
        })}
      />
    ),
  },
]
