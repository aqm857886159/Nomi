// 设计实验室 · Agent 面板状态注册表（P0 异常态 · 2026-09-03 走读附录索引）
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
import {
  ResidentArtifactCard,
  ResidentAtPicker,
  ResidentCandidatesCard,
  ResidentDeviationCard,
  ResidentFoldableText,
  ResidentQuestionCard,
  ResidentSpendCard,
  ResidentWriteFailureRow,
} from '../../../workbench/ai/resident/ResidentExceptionStates'
import { ResidentToolChips } from '../../../workbench/ai/resident/ResidentUiPrimitives'
import { hostState, queueItem, userItem } from '../agentPanelFixtures'
import {
  LAB_ASSETS,
  LONG_PLAN_SHOTS,
  LONG_TEXT,
  NOOP,
  PieceStage,
  planCard,
  ShellStage,
  type LabState,
} from '../agentPanelKit'

// ── P0 异常态 17 件（2026-09-03 走读附录索引） ────────────────────────────────

export const EXCEPTION_STATES: readonly LabState[] = [
  {
    id: 'p0-01-bubble-long',
    name: 'P0 件 1 · 用户气泡 × 超长',
    source: '2026-09-03 走读 族1 件 1',
    coverage: 'component-only',
    render: () => (
      <PieceStage>
        <ResidentFoldableText text={LONG_TEXT} expandLabel="还有 3 行" collapseLabel="收起" dataUserContent />
      </PieceStage>
    ),
  },
  {
    id: 'p0-02-tool-many',
    name: 'P0 件 2 · 工具条 × 超多步',
    source: '2026-09-03 走读 族1 件 2',
    coverage: 'component-only',
    render: () => (
      <PieceStage>
        <ResidentToolChips
          items={Array.from({ length: 24 }, (_, index) => ({
            id: `t${index}`,
            label: index % 3 === 0 ? '生成参考图' : index % 3 === 1 ? '读分镜' : '检查参数',
            name: 'generate_image',
            summary: '第 ' + (index + 1) + ' 步',
            result: '完成',
            status: 'done' as const,
          }))}
          emptyLabel="没有细节"
          statusLabel={() => '完成'}
          sectionLabel="工具调用"
          headerLabel="24 步 · 生成参考图 · 读分镜 · 检查参数"
          explanationLabel="它做了什么"
          targetLabel="作用在"
          resultLabel="结果"
          technicalLabel="技术细节"
        />
      </PieceStage>
    ),
  },
  {
    id: 'p0-03-reply-long',
    name: 'P0 件 3 · 普通回复 × 超长',
    source: '2026-09-03 走读 族1 件 3',
    coverage: 'component-only',
    render: () => (
      <PieceStage>
        <ResidentFoldableText text={LONG_TEXT} expandLabel="还有约 120 字" collapseLabel="收起" />
      </PieceStage>
    ),
  },
  {
    id: 'p0-04-plan-many',
    name: 'P0 件 4 · 计划卡 × 超多镜',
    source: '2026-09-03 走读 族1 件 4（卡内滚动封顶 220px）',
    coverage: 'component-only',
    render: () => <PieceStage>{planCard('ready', LONG_PLAN_SHOTS)}</PieceStage>,
  },
  {
    id: 'p0-05-queue-many',
    name: 'P0 件 5 · 排队行 × 超多条',
    source: '2026-09-03 走读 族1 件 5（形态 11/18 共用）',
    coverage: 'shell',
    render: () => (
      <ShellStage
        snapshot={hostState({
          turnStatus: 'running',
          items: [userItem('先把第一批生出来')],
          queue: ['q1', 'q2', 'q3', 'q4', 'q5'].map((id) => queueItem(id, 'queued')),
        })}
      />
    ),
  },
  {
    id: 'p0-06-candidates-many',
    name: 'P0 件 6 · 多候选组 × 超多版',
    source: '2026-09-03 走读 族1 件 6（+N 盒）',
    coverage: 'component-only',
    render: () => (
      <PieceStage>
        <ResidentCandidatesCard
          candidates={['A', 'B', 'C', 'D', 'E'].map((label) => ({ id: label, label: `${label} 版` }))}
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
    id: 'p0-07-deviation-many',
    name: 'P0 件 7 · 有出入卡 × 超多处',
    source: '2026-09-03 走读 族1 件 7',
    coverage: 'component-only',
    render: () => (
      <PieceStage>
        <ResidentDeviationCard
          deviations={Array.from({ length: 7 }, (_, index) => ({
            where: `镜 ${index + 1}`,
            field: index % 2 ? '人物' : '画幅',
            detail: index % 2 ? '雨衣颜色和定妆照对不上' : '要的是 16:9，出来的是 4:3',
          }))}
          moreLabel="有 7 处和你要的不一样"
          collapseLabel="收起"
          actions={['让 AI 修', '撤销这一步', '知道了']}
          onAction={NOOP}
        />
      </PieceStage>
    ),
  },
  {
    id: 'p0-08-question-many',
    name: 'P0 件 8 · 反问卡 × 超多选项',
    source: '2026-09-03 走读 族1 件 8',
    coverage: 'component-only',
    render: () => (
      <PieceStage>
        <ResidentQuestionCard
          question={LONG_TEXT}
          options={['冷冽写实', '霓虹赛博', '黑白硬派', '暖色怀旧', '手持纪实', '高对比广告'].map((label) => ({
            id: label,
            label,
          }))}
          pageLabel="1 / 3"
          moreLabel="+2 更多选项"
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
    id: 'p0-09-at-picker-search',
    name: 'P0 件 9 · @ 选择器 × 素材 >50',
    source: '2026-09-03 走读 族1 件 9（偏离折叠族：搜索代替折叠）',
    coverage: 'component-only',
    render: () => (
      <PieceStage>
        <ResidentAtPicker
          assets={LAB_ASSETS}
          groups={[]}
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
    id: 'p0-10-plan-failed',
    name: 'P0 件 10 · 计划生成失败',
    source: '2026-09-03 走读 族2 件 10',
    coverage: 'component-only',
    render: () => <PieceStage>{planCard('failed', [])}</PieceStage>,
  },
  {
    id: 'p0-11-price-failed',
    name: 'P0 件 11 · 价格算不出',
    source: '2026-09-03 走读 族2 件 11',
    coverage: 'component-only',
    render: () => (
      <PieceStage>
        <ResidentSpendCard
          knownRows={[
            { label: '镜数', value: '5 镜' },
            { label: '模型', value: 'seedream 4.0' },
          ]}
          amount={null}
          failureReason="暂时算不出价格"
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
    id: 'p0-12-write-failed',
    name: 'P0 件 12 · 写入画布失败',
    source: '2026-09-03 走读 族2 件 12',
    coverage: 'component-only',
    render: () => (
      <PieceStage>
        <ResidentWriteFailureRow
          reason="5 个画面没加进去"
          billing="画布刚好在忙，这次没扣钱"
          retryLabel="重试"
          onRetry={NOOP}
        />
      </PieceStage>
    ),
  },
  {
    id: 'p0-13-artifact-failed',
    name: 'P0 件 13 · 产物卡 × 生成失败',
    source: '2026-09-03 走读 族2 件 13',
    coverage: 'component-only',
    render: () => (
      <PieceStage>
        <ResidentArtifactCard
          state="failed"
          title="镜 3 巷口急转"
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
    id: 'p0-14-plan-loading',
    name: 'P0 件 14 · 计划卡 × 生成中骨架',
    source: '2026-09-03 走读 族3 件 14',
    coverage: 'component-only',
    render: () => <PieceStage>{planCard('loading', [])}</PieceStage>,
  },
  {
    id: 'p0-15-artifact-loading',
    name: 'P0 件 15 · 产物卡 × 生成中',
    source: '2026-09-03 走读 族3 件 15',
    coverage: 'component-only',
    render: () => (
      <PieceStage>
        <ResidentArtifactCard
          state="loading"
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
    id: 'p0-16-at-picker-empty',
    name: 'P0 件 16 · @ 选择器 × 无素材',
    source: '2026-09-03 走读 族4 件 16',
    coverage: 'component-only',
    render: () => (
      <PieceStage>
        <ResidentAtPicker
          assets={[]}
          groups={[]}
          emptyTitle="这个项目还没有素材"
          emptyDescription="先上传一张参考图或定妆照，之后打 @ 就能引用它"
          uploadLabel="去上传素材"
          searchLabel="搜索素材"
          onPickAsset={NOOP}
          onUpload={NOOP}
        />
      </PieceStage>
    ),
  },
]
