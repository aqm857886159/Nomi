// 设计实验室 · Agent 面板 v4 · **Composer 板**
//
// 这一组每一格只渲 **composer 本身**（或它的一个弹层），因为定稿 Composer 板画的就是它。
// 高度三格（① 初始一行 · ② 自动增长 · ③ 封顶滚动）刻意用**同一个组件、只换喂进去的文本**——
// 高度是 `useComposerHeight(panelHeight, mode)` 从内容 derive 的，不是三套写死的样式。
// 上限档位（≥800 → 40%、640–800 → 30%、<640 → 6 行）靠喂不同的 panelHeight 走到。
import React, { type JSX } from 'react'
import {
  AgentPanelV4Composer,
  V4ModelPopover,
  V4PermissionPopover,
  V4SkillPopover,
} from '../../../../workbench/ai/v4/AgentPanelV4Composer'
import { fixedEditorOwner } from '../../fixedEditorOwner'
import type { ComposerMode, PermissionTier } from '../../../../workbench/ai/v4/agentPanelV4Types'
import { Piece, useV4Fixtures } from '../agentPanelV4LabKit'
import { useGenerationCanvasStore } from '../../../../workbench/generationCanvas/store/generationCanvasStore'
import type { GenerationCanvasNode } from '../../../../workbench/generationCanvas/model/generationCanvasTypes'
import { mention } from '../../nodeComposerBar/nodeComposerB3LabKit'
import type { LabState } from '../../labScreen'


function ComposerCell({
  mode = 'idle',
  permission = 'request',
  withChips = false,
  text,
  panelHeight = 620,
  focused = false,
  skillSelected = false,
  awaitingAnswer = false,
}: {
  mode?: ComposerMode
  permission?: PermissionTier
  withChips?: boolean
  text?: string
  panelHeight?: number
  focused?: boolean
  skillSelected?: boolean
  awaitingAnswer?: boolean
}): JSX.Element {
  const fx = useV4Fixtures()
  return (
    <Piece>
      <AgentPanelV4Composer
        panelHeight={panelHeight}
        mode={mode}
        permission={permission}
        focused={focused}
        skillSelected={skillSelected || withChips}
        awaitingAnswer={awaitingAnswer}
        chips={withChips ? [fx.chips.attachment, fx.chips.skill, fx.chips.clip] : undefined}
        draft={fixedEditorOwner(text ?? '')}
        draftReadOnly
      />
    </Piece>
  )
}

/**
 * E1b：Agent 输入框的参考按钮（iconOnly 摆法：28px、图标 16 / 2，和附件、模型同一排）+ 句中引用显示「小图 + 名字」。
 * 名字从画布上出这张图的节点标题读（referenceNameKey），不是图1、图2。
 */
function ReferenceButtonCell(): JSX.Element {
  const [ready, setReady] = React.useState(false)
  React.useLayoutEffect(() => {
    const url = (name: string): string => `${window.location.origin}/tests/ux/fixtures/b3-refs/${encodeURIComponent(name)}.svg`
    const node = (name: string, index: number): GenerationCanvasNode => ({
      id: `e1b-${index}`, kind: 'image', categoryId: 'shots', title: name, prompt: '', position: { x: index * 200, y: 0 },
      size: { width: 120, height: 90 }, status: 'success', result: { id: `e1b-r-${index}`, type: 'image', url: url(name), createdAt: 1 },
    } as GenerationCanvasNode)
    useGenerationCanvasStore.setState({ nodes: [node('女主肖像', 0), node('海边小镇', 1)], edges: [], selectedNodeIds: [] })
    setReady(true)
  }, [])
  const text = `${mention('女主肖像')} 走进 ${mention('海边小镇')}，镜头缓慢推近。`
  return ready ? (
    <Piece>
      <AgentPanelV4Composer panelHeight={620} mode="idle" permission="request" draft={fixedEditorOwner(text)} draftReadOnly onAddReference={() => undefined} onAddFile={() => undefined} modelLabel="Claude" />
    </Piece>
  ) : <Piece><div /></Piece>
}

export const V4_COMPOSER_STATES: readonly LabState[] = [
  {
    id: 'v4-composer-idle',
    name: 'composer · 空闲（一行）',
    source: '2026-09-06-agent-panel-v4.md · Composer 板',
    coverage: 'component-only',
    render: () => <ComposerCell focused />,
  },
  {
    id: 'v4-composer-awaiting-answer',
    name: 'composer · 上面有问题待答（降一档：淡 + 换占位，仍可用）',
    source: '2026-09-21 拍板：有问题待答时下方 composer 降一档',
    coverage: 'component-only',
    render: () => <ComposerCell awaitingAnswer />,
  },
  {
    id: 'v4-composer-running',
    name: 'composer · 运行中（■ 停止 + 排队占位）',
    source: '2026-09-06-agent-panel-v4.md · Composer 板',
    coverage: 'component-only',
    render: () => <ComposerCell mode="running" />,
  },
  {
    id: 'v4-composer-reference',
    name: 'composer · 带引用（附件 / 技能 / 片段三种 chip）',
    source: '2026-09-06-agent-panel-v4.md · Composer 板',
    coverage: 'component-only',
    render: () => {
      const Cell = (): JSX.Element => {
        const fx = useV4Fixtures()
        return <ComposerCell mode="reference" withChips text={fx.t('agentPanelV4.fixtureRestylePrompt')} />
      }
      return <Cell />
    },
  },
  {
    id: 'v4-composer-reference-button',
    name: 'composer · 参考按钮（E1b：iconOnly 28px，引用显示小图 + 名字）',
    source: 'docs/design/boards/2026-10-18/ComposerB3.board.json · host.agent-input-ref-button',
    coverage: 'component-only',
    render: () => <ReferenceButtonCell />,
  },
  {
    id: 'v4-composer-model-popover',
    name: 'composer · 模型弹层（对话 + 图片/视频两类默认 + 单价）',
    source: '2026-09-06-agent-panel-v4.md · Composer 板',
    coverage: 'component-only',
    render: () => {
      const Cell = (): JSX.Element => {
        const fx = useV4Fixtures()
        return (
          <Piece>
            <V4ModelPopover rows={fx.modelRows} />
          </Piece>
        )
      }
      return <Cell />
    },
  },
  {
    id: 'v4-composer-skill-popover',
    name: 'composer · Skill 弹层（搜索 + 分类 + 列表）',
    source: '2026-09-06-agent-panel-v4.md · Composer 板',
    coverage: 'component-only',
    render: () => {
      const Cell = (): JSX.Element => {
        const fx = useV4Fixtures()
        return (
          <Piece>
            <V4SkillPopover rows={fx.commandRows} categories={fx.commandCategories} query="" />
          </Piece>
        )
      }
      return <Cell />
    },
  },
  {
    id: 'v4-composer-permission-popover',
    name: 'composer · 权限弹层（两档竖排，每档下一行灰字）',
    source: '2026-10-12 用户：挡位改两档，每个挡位下面写个灰字描述',
    coverage: 'component-only',
    render: () => (
      <Piece>
        <V4PermissionPopover permission="request" />
      </Piece>
    ),
  },
  {
    id: 'v4-composer-permission-request',
    name: 'composer · 权限「请求批准」（request · 默认）',
    source: '2026-10-12 用户：挡位改两档',
    coverage: 'component-only',
    render: () => <ComposerCell permission="request" />,
  },
  {
    id: 'v4-composer-permission-direct',
    name: 'composer · 权限「直接生成」（direct · 带刹车）',
    source: '2026-10-12 用户：挡位改两档',
    coverage: 'component-only',
    render: () => <ComposerCell permission="direct" />,
  },
  {
    id: 'v4-composer-height-one-line',
    name: '高度① 初始一行（面板 620 → 86px）',
    source: '2026-09-06-agent-panel-v4.md · Composer 板',
    coverage: 'component-only',
    render: () => <ComposerCell panelHeight={620} />,
  },
  {
    id: 'v4-composer-height-grow',
    name: '高度② 逐行长（四行，工具条贴底不动）',
    source: '2026-09-06-agent-panel-v4.md · Composer 板',
    coverage: 'component-only',
    render: () => {
      const Cell = (): JSX.Element => {
        const fx = useV4Fixtures()
        return <ComposerCell focused panelHeight={620} text={fx.t('agentPanelV4.fixtureMultilinePrompt')} />
      }
      return <Cell />
    },
  },
  {
    id: 'v4-composer-height-capped',
    name: '高度③ 封顶（面板 620 → 6 行上限，内部滚动）',
    source: '2026-09-06-agent-panel-v4.md · Composer 板',
    coverage: 'component-only',
    render: () => {
      const Cell = (): JSX.Element => {
        const fx = useV4Fixtures()
        return <ComposerCell focused panelHeight={620} text={fx.t('agentPanelV4.fixtureLongPrompt')} />
      }
      return <Cell />
    },
  },
  {
    id: 'v4-composer-height-tall-panel',
    name: '高度上限 · 面板 900（同一段文本不再被截断）',
    source: '2026-09-06-agent-panel-v4.md · Composer 板',
    coverage: 'component-only',
    render: () => {
      const Cell = (): JSX.Element => {
        const fx = useV4Fixtures()
        return <ComposerCell focused panelHeight={900} text={fx.t('agentPanelV4.fixtureLongPrompt')} />
      }
      return <Cell />
    },
  },
  {
    id: 'v4-composer-dock',
    name: '收起坞里的 composer（上限 6 行，压在画面上）',
    source: '2026-09-06-agent-panel-v4.md · Collapsed 板',
    coverage: 'component-only',
    render: () => {
      const Cell = (): JSX.Element => {
        const fx = useV4Fixtures()
        return (
          <Piece width={560}>
            <AgentPanelV4Composer
              panelHeight={860}
              dock
              mode="running"
              chips={[fx.chips.clip]}
              draft={fixedEditorOwner<string>(fx.t('agentPanelV4.fixtureUserTrim'))}
              draftReadOnly
            />
          </Piece>
        )
      }
      return <Cell />
    },
  },
]
