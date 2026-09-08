// 设计实验室 · primitive 陈列 · 结构与身份族。
//
// 这一屏原本摆着三件「有但没人用」的结构件（`DesignTable` / `DesignPagination` /
// `DesignPageShell`）当对照物；2026-09-07 逐件重数后三件全删（ps-12 / ps-13 / ps-17 空号不补位）。
// 剩下的是身份族：它们是品牌不变量的唯一真相源（字标中间的 m 永远 accent），
// 任何一处手写 `No<span>m</span>i` 都算漂移。`NomiPreviewHost` 是这屏唯一的非产品件——
// 它的消费者在 `design-sync.config.json` 的 `provider`，不在 App 里。
//
// ⚠️ 2026-09-07（用户抓到的系统性缺陷）：陈列「渲染的是现役组件本体」只管住了**组件**，
// 管不住 **props**。这一屏两处已改：`NomiWordmark` 补 `className` 色（6 个真实调用点里 5 个
// 都传——字标只有中间那个 m 恒 accent，`No`/`i` 的颜色是**调用方**给的）、`NomiLoadingMark`
// 补 `label`（约 8 处真实调用点传它，那是转圈的无障碍名字）；`NomiIdentityIcon` 补 `src`
// 品牌图层（生产的主形态是图层压在字母回退上，此前 8 个样本一个都没有 src，
// 只陈列了那个在生产里属于例外的回退层），并把两字母回退改成单字母（真实 fallback 都是一个字）。
// 另外 `NomiAILabel` 是**零采纳件**，此前这一格没标出来——已在样本标签上写明。
import React from 'react'

import {
  NomiAILabel,
  NomiBrand,
  NomiIdentityIcon,
  NomiLoadingMark,
  NomiLogoMark,
  NomiStepper,
  NomiWordmark,
} from '../../../../design'
import { NomiPreviewHost } from '../../../../design/previewHost'

/** 真实品牌图源：与 `modelIdentityIcon` 用的是**同一个**本地资源（不新造一张图）。 */
const DOUBAO_LOGO = new URL('../../../../assets/vendor-logos/doubao.png', import.meta.url).href
const MINIMAX_LOGO = new URL('../../../../assets/vendor-logos/minimax.png', import.meta.url).href
const APIMART_LOGO = new URL('../../../../assets/vendor-logos/apimart.png', import.meta.url).href
const KIE_LOGO = new URL('../../../../assets/vendor-logos/kie.png', import.meta.url).href
import { PrimitiveStage, Specimen, Stateful } from '../../primitives/primitivesLabKit'
import type { LabState } from '../../labScreen'

const SOURCE_IDENTITY = 'src/design/identity.tsx · docs/design/nomi-design-system.md §1 品牌'

export const STRUCTURE_STATES: readonly LabState[] = [
  {
    id: 'ps-14-identity',
    name: 'Nomi 身份族 · 字标 / 品牌 / 标记 / 转圈 / AI 标 / 步进',
    source: SOURCE_IDENTITY,
    mirrors: [
      'src/ui/app-shell/NomiAppBar.tsx:119',
      'src/ui/app-shell/NomiAppBar.tsx:218',
      'src/workbench/promptLibrary/PromptLibraryPanel.tsx:288',
      'src/workbench/generationCanvas/nodes/render/CardCommon.tsx:379',
    ],
    coverage: 'shell',
    // 字标中间的 m 永远 accent 色是品牌不变量（`NomiWordmark` 是它的唯一真相源）。
    // 这一格钉住的就是那一个字母的颜色——全仓任何一处手写字标都会与它对不上。
    render: () => (
      <PrimitiveStage>
        {/* 字标只有中间那个 m 恒 accent；`No`/`i` 的颜色由**调用方**的 className 决定
            （6 个真实调用点里 5 个都传色）。裸着摆等于宣称有一个「默认字标色」，而那个默认
            在生产里几乎没出现过。 */}
        <Specimen label="NomiWordmark · 13 / 17 / 24px（m 恒 accent，其余色由调用方给）">
          <NomiWordmark fontSize={13} className="text-nomi-ink-40" />
          <NomiWordmark fontSize={17} className="text-nomi-ink-60" />
          <NomiWordmark fontSize={24} className="text-nomi-ink" />
        </Specimen>
        <Specimen label="NomiBrand（标记 + 字标 · 顶栏裸用）/ NomiLogoMark size=24">
          <NomiBrand />
          <NomiLogoMark size={24} />
        </Specimen>
        <Specimen label="⚠️ NomiAILabel：组件已实现，生产零调用点（本格是能力展示，不是现役形态）">
          <NomiAILabel />
        </Specimen>
        {/*
          ⚠️ 「全仓唯一转圈件」这句话是假的（本次已从上面的样本标签里删掉）：另有 4 处
          独立的 `IconLoader2 animate-spin`（`nodes/NodeDeconstructionPanel.tsx:375`、
          `ai/v4/AgentPanelV4Icons.tsx:75`、`assets/AssetPreviewDialog.tsx:179,191`）
          与 2 处手画的 CSS 圆环转圈（`ui/browser/popover/BrowserAssetPopoverParts.tsx:114,187`）。
          本次这一格本来就要重录（props 按真实调用点改了），所以顺手把那句假话也改掉了。
          真正的收口（把那 6 处手写转圈迁到 NomiLoadingMark）仍是独立一刀，不在本次范围。
        */}
        <Specimen label="NomiLoadingMark · 14 / 18 / 32px + label（约 8 处真实调用点都传 label）">
          <NomiLoadingMark size={14} />
          <NomiLoadingMark size={18} label="正在生成" />
          <NomiLoadingMark size={32} label="正在生成" />
        </Specimen>
        <Specimen label="NomiStepper · 三段（真状态，可点）" align="stretch">
          <Stateful initial={'creation' as 'creation' | 'storyboard' | 'generation' | 'preview'}>
            {(mode, set) => <NomiStepper value={mode} onChange={set} />}
          </Stateful>
        </Specimen>
      </PrimitiveStage>
    ),
  },
  {
    id: 'ps-15-identity-icon',
    name: 'NomiIdentityIcon · 品牌图层 / 单字母回退 / 无回退（sm=下拉触发、md=下拉行）',
    source: 'src/design/NomiIdentityIcon.tsx · 只用本地标记，永不拉远端 favicon',
    // 直接调用点为零：它只经 `NomiSelect` 到达生产，图源来自 `modelIdentityIcon`。
    mirrors: [
      'src/config/modelProviderIdentity.ts:36',
      'src/design/NomiSelect.tsx:192',
      'src/design/NomiSelect.tsx:233',
    ],
    coverage: 'shell',
    // 2026-09-07 修正三处：
    //   · 补 `src` 品牌图层——生产的**主形态**是本地 logo 压在字母回退之上
    //     （`modelIdentityIcon` 每一条返回值都带 src）；此前 8 个样本一个都没有 src，
    //     陈列出来的全是那个只在图挂掉时才露出来的回退层。
    //   · 回退改成**单字母**：真实 fallback 都是一个字（'D'/'M'/'E'…），
    //     而组件对回退做 `slice(0, 2)`——原来那个三字母的 'KIE' 会被静默截成 'KI'，
    //     等于陈列了一个永远显示不全的形态。
    //   · sm / md 不是自由选择：sm 是收起的触发 pill，md 是展开的下拉行，标签写清楚。
    render: () => (
      <PrimitiveStage>
        <Specimen label="品牌图层 + 单字母回退（生产主形态 · 图挂掉才露回退）">
          <NomiIdentityIcon icon={{ kind: 'model', src: DOUBAO_LOGO, fallback: 'D' }} />
          <NomiIdentityIcon icon={{ kind: 'model', src: MINIMAX_LOGO, fallback: 'M' }} size="md" />
          <NomiIdentityIcon icon={{ kind: 'provider', src: APIMART_LOGO, fallback: 'A' }} />
          <NomiIdentityIcon icon={{ kind: 'provider', src: KIE_LOGO, fallback: 'K' }} size="md" />
        </Specimen>
        <Specimen label="只有单字母回退 · sm（16px · 收起 pill）/ md（18px · 下拉行）">
          <NomiIdentityIcon icon={{ kind: 'model', fallback: 'D' }} />
          <NomiIdentityIcon icon={{ kind: 'model', fallback: 'M' }} size="md" />
          <NomiIdentityIcon icon={{ kind: 'provider', fallback: 'A' }} />
          <NomiIdentityIcon icon={{ kind: 'provider', fallback: 'K' }} size="md" />
        </Specimen>
        <Specimen label="无回退 · 按 kind 落图标（model=盒子 / provider=插头）">
          <NomiIdentityIcon icon={{ kind: 'model' }} />
          <NomiIdentityIcon icon={{ kind: 'model' }} size="md" />
          <NomiIdentityIcon icon={{ kind: 'provider' }} />
          <NomiIdentityIcon icon={{ kind: 'provider' }} size="md" />
        </Specimen>
      </PrimitiveStage>
    ),
  },
  {
    id: 'ps-16-preview-host',
    name: 'NomiPreviewHost · App 之外挂载设计组件的最小 provider',
    source: 'src/design/previewHost.tsx · design-sync 组件库预览卡专用',
    // 按设计就没有 App 内调用点：它的消费者是 design-sync 的组件库预览卡
    // （`design-sync.config.json` 的 provider），不是 `src/` 里的任何界面。
    mirrors: 'none — 零采纳件（按设计如此：消费者是 design-sync.config.json，不在 App 里）',
    coverage: 'component-only',
    // 它不是"长得像什么"的组件，是一层 provider（i18n + Mantine 主题）。这一格证明的是
    // **它还能把组件挂起来**：里面那几件如果画不出来，说明 provider 已经和真 App 脱节了。
    render: () => (
      <PrimitiveStage>
        <Specimen label="包在 NomiPreviewHost 里的身份族（文案走它自己的 i18n 实例）" align="stretch">
          <NomiPreviewHost>
            <div className="flex items-center gap-3">
              <NomiBrand />
              <NomiAILabel />
              <NomiLoadingMark size={18} />
            </div>
          </NomiPreviewHost>
        </Specimen>
      </PrimitiveStage>
    ),
  },
]
