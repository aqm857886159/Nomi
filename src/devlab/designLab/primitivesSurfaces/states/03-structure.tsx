// 设计实验室 · primitive 陈列 · 结构与身份族。
//
// `DesignTable` / `DesignPagination` / `DesignPageShell` 三件全仓零调用，`NomiPreviewHost`
// 只被 design-sync 预览用；`Nomi*` 身份族则相反——它们是品牌不变量的唯一真相源
// （字标中间的 m 永远 accent），任何一处手写 `No<span>m</span>i` 都算漂移。
// 一族「有但没人用」、一族「不许另写一份」，摆在同一屏上正好互为对照。
import React from 'react'

import {
  DesignPageShell,
  DesignPagination,
  DesignTable,
  NomiAILabel,
  NomiBrand,
  NomiIdentityIcon,
  NomiLoadingMark,
  NomiLogoMark,
  NomiStepper,
  NomiWordmark,
} from '../../../../design'
import { NomiPreviewHost } from '../../../../design/previewHost'
import { PrimitiveStage, Specimen, Stateful } from '../../primitives/primitivesLabKit'
import type { LabState } from '../../labScreen'

const SOURCE_STRUCTURE = 'src/design/tables.tsx + navigation.tsx + layout.tsx · 全仓零调用件'
const SOURCE_IDENTITY = 'src/design/identity.tsx · docs/design/nomi-design-system.md §1 品牌'

const TABLE_DATA = {
  head: ['镜号', '模型', '状态'],
  body: [
    ['01', 'Seedream 4.5', '已完成'],
    ['02', 'Kling 2.5 Turbo', '生成中'],
    ['03', 'Nano Banana Pro', '待生成'],
  ],
}

export const STRUCTURE_STATES: readonly LabState[] = [
  {
    id: 'ps-12-table',
    name: 'DesignTable · 默认 / 描边 / 斑马纹（全仓零调用）',
    source: SOURCE_STRUCTURE,
    coverage: 'component-only',
    render: () => (
      <PrimitiveStage>
        <Specimen label="默认" align="stretch">
          <DesignTable data={TABLE_DATA} />
        </Specimen>
        <Specimen label="withTableBorder + striped" align="stretch">
          <DesignTable withTableBorder withColumnBorders striped data={TABLE_DATA} />
        </Specimen>
      </PrimitiveStage>
    ),
  },
  {
    id: 'ps-13-pagination',
    name: 'DesignPagination · 首页 / 中间页 / 禁用（全仓零调用）',
    source: SOURCE_STRUCTURE,
    coverage: 'component-only',
    render: () => (
      <PrimitiveStage>
        <Specimen label="value=1 · total=8" align="stretch">
          <Stateful initial={1}>{(page, set) => <DesignPagination total={8} value={page} onChange={set} />}</Stateful>
        </Specimen>
        <Specimen label="value=4 · total=8（带首尾跳转）" align="stretch">
          <Stateful initial={4}>
            {(page, set) => <DesignPagination withEdges total={8} value={page} onChange={set} />}
          </Stateful>
        </Specimen>
        <Specimen label="disabled" align="stretch">
          {/* 同上：禁用格也接真 setter，不留占位 handler。 */}
          <Stateful initial={1}>{(page, set) => <DesignPagination total={8} value={page} disabled onChange={set} />}</Stateful>
        </Specimen>
      </PrimitiveStage>
    ),
  },
  {
    id: 'ps-14-identity',
    name: 'Nomi 身份族 · 字标 / 品牌 / 标记 / 转圈 / AI 标 / 步进',
    source: SOURCE_IDENTITY,
    coverage: 'shell',
    // 字标中间的 m 永远 accent 色是品牌不变量（`NomiWordmark` 是它的唯一真相源）。
    // 这一格钉住的就是那一个字母的颜色——全仓任何一处手写字标都会与它对不上。
    render: () => (
      <PrimitiveStage>
        <Specimen label="NomiWordmark · 13 / 17 / 24px（m 恒 accent）">
          <NomiWordmark fontSize={13} />
          <NomiWordmark fontSize={17} />
          <NomiWordmark fontSize={24} />
        </Specimen>
        <Specimen label="NomiBrand（标记 + 字标）/ NomiLogoMark / NomiAILabel">
          <NomiBrand />
          <NomiLogoMark size={24} />
          <NomiAILabel />
        </Specimen>
        <Specimen label="NomiLoadingMark · 14 / 18 / 26px（全仓唯一转圈件）">
          <NomiLoadingMark size={14} />
          <NomiLoadingMark size={18} />
          <NomiLoadingMark size={26} />
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
    name: 'NomiIdentityIcon · 模型 / 供应商 × sm / md × 有无字母回退',
    source: 'src/design/NomiIdentityIcon.tsx · 只用本地标记，永不拉远端 favicon',
    coverage: 'shell',
    render: () => (
      <PrimitiveStage>
        <Specimen label="有字母回退 · size=sm（16px）/ md（18px）">
          <NomiIdentityIcon icon={{ kind: 'model', fallback: 'SD' }} />
          <NomiIdentityIcon icon={{ kind: 'model', fallback: 'KL' }} size="md" />
          <NomiIdentityIcon icon={{ kind: 'provider', fallback: 'AM' }} />
          <NomiIdentityIcon icon={{ kind: 'provider', fallback: 'KIE' }} size="md" />
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
  {
    id: 'ps-17-page-shell',
    name: 'DesignPageShell · 整页外壳（min-h-screen，全仓零调用）',
    source: SOURCE_STRUCTURE,
    coverage: 'component-only',
    // 它是 min-h-screen 的整页底，按元素截就是一张视口高的图——所以这一格取整屏，
    // 与别的格不同不是疏忽，是这件组件的尺度本来就是"一页"。
    capture: 'viewport',
    render: () => (
      <DesignPageShell>
        <div className="flex flex-col gap-4 p-8">
          <NomiBrand />
          <div className="text-display font-semibold">项目库</div>
          <div className="text-body text-nomi-ink-60">DesignPageShell 只提供整页底色、字族与最小高度，内容由页面自己排。</div>
          <DesignTable data={TABLE_DATA} />
        </div>
      </DesignPageShell>
    ),
  },
]
