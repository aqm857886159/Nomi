// 设计实验室 · primitive 陈列 · 输入族。
//
// `Design*` 输入件全部是 Mantine 原语外裹一层 token className（`src/design/forms.tsx`）。
// 它们的四态（默认 / 有标签说明 / 报错 / 禁用）此前一张基线都没有——而报错态正是
// 优化方案 §0 那张表里「状态四态只住在文档里」那一行说的东西：文档要求四态，
// 现役 error/loading 两处被 empty 冒名顶替。摆出来，才谈得上钉住。
import React from 'react'
import { IconUpload } from '@tabler/icons-react'

import {
  DesignCheckbox,
  DesignFileInput,
  DesignNumberInput,
  DesignSearchInput,
  DesignSwitch,
  DesignTextInput,
  DesignTextarea,
} from '../../../../design'
import { PrimitiveStage, Specimen, Stateful } from '../../primitives/primitivesLabKit'
import type { LabState } from '../../labScreen'

const SOURCE_FORMS = 'src/design/forms.tsx · docs/design/nomi-design-system.md §3 表单'

export const INPUT_STATES: readonly LabState[] = [
  {
    id: 'pf-01-text-input-four-states',
    name: 'DesignTextInput · 默认 / 带标签说明 / 报错 / 禁用',
    source: SOURCE_FORMS,
    coverage: 'shell',
    render: () => (
      <PrimitiveStage>
        <Specimen label="默认（只有占位）" align="stretch">
          <DesignTextInput placeholder="项目名称" />
        </Specimen>
        <Specimen label="带标签 + 说明" align="stretch">
          <DesignTextInput label="项目名称" description="导出的文件会用这个名字" defaultValue="夏日短片" />
        </Specimen>
        <Specimen label="报错（error）" align="stretch">
          <DesignTextInput label="API Key" defaultValue="sk-短了" error="这个 Key 的长度不对" />
        </Specimen>
        <Specimen label="禁用" align="stretch">
          <DesignTextInput label="项目路径" defaultValue="~/Documents/Nomi Projects" disabled />
        </Specimen>
      </PrimitiveStage>
    ),
  },
  {
    id: 'pf-02-textarea-number',
    name: 'DesignTextarea（autosize）/ DesignNumberInput',
    source: SOURCE_FORMS,
    coverage: 'shell',
    render: () => (
      <PrimitiveStage>
        <Specimen label="Textarea · autosize 默认开（内容多一行就长一行）" align="stretch">
          <DesignTextarea
            label="镜头提示词"
            defaultValue={'黄昏的海边，少年逆光走向镜头。\n手持轻微晃动，暖色调。'}
          />
        </Specimen>
        <Specimen label="Textarea · 报错" align="stretch">
          <DesignTextarea label="镜头提示词" defaultValue="" error="提示词不能为空" />
        </Specimen>
        <Specimen label="NumberInput · 默认 / 禁用" align="stretch">
          <DesignNumberInput label="时长（秒）" defaultValue={5} min={1} max={10} />
          <DesignNumberInput label="时长（秒）" defaultValue={5} disabled />
        </Specimen>
      </PrimitiveStage>
    ),
  },
  {
    id: 'pf-03-switch-checkbox',
    name: 'DesignSwitch / DesignCheckbox · 开 / 关 / 禁用',
    source: SOURCE_FORMS,
    coverage: 'shell',
    // 真状态：点得动。挂空 handler 会让陈列变成一张骗人的图（见取景台头注纪律 2）。
    render: () => (
      <PrimitiveStage>
        <Specimen label="Switch · 关 / 开（可点）" align="stretch">
          <Stateful initial={false}>
            {(on, set) => <DesignSwitch checked={on} onChange={(event) => set(event.currentTarget.checked)} label="发送匿名诊断" />}
          </Stateful>
          <Stateful initial={true as boolean}>
            {(on, set) => <DesignSwitch checked={on} onChange={(event) => set(event.currentTarget.checked)} label="天黑自动暗" />}
          </Stateful>
        </Specimen>
        <Specimen label="Switch · 禁用（关 / 开）" align="stretch">
          <DesignSwitch checked={false} readOnly disabled label="发送匿名诊断" />
          <DesignSwitch checked readOnly disabled label="天黑自动暗" />
        </Specimen>
        <Specimen label="Checkbox · 关 / 开 / 禁用" align="stretch">
          <Stateful initial={false}>
            {(on, set) => <DesignCheckbox checked={on} onChange={(event) => set(event.currentTarget.checked)} label="记住这次选择" />}
          </Stateful>
          <Stateful initial={true as boolean}>
            {(on, set) => <DesignCheckbox checked={on} onChange={(event) => set(event.currentTarget.checked)} label="导出后打开文件夹" />}
          </Stateful>
          <DesignCheckbox checked readOnly disabled label="已由项目设置锁定" />
        </Specimen>
      </PrimitiveStage>
    ),
  },
  {
    id: 'pf-04-file-input',
    name: 'DesignFileInput · 空 / 有值 / 禁用（全仓零调用件）',
    source: 'src/design/forms.tsx DesignFileInput · 优化方案「零调用组件照样进陈列」',
    coverage: 'component-only',
    // coverage=component-only 是这一格的重点：组件在、现役界面里没有任何路径走到它。
    // 陈列的意义正是让「有什么」可见——零调用件的漂移在功能屏上永远看不见。
    render: () => (
      <PrimitiveStage>
        <Specimen label="空态（占位 + 图标）" align="stretch">
          <DesignFileInput label="导入素材" placeholder="选择文件" leftSection={<IconUpload size={14} />} />
        </Specimen>
        <Specimen label="有值" align="stretch">
          <DesignFileInput
            label="导入素材"
            placeholder="选择文件"
            value={new File([], 'shot-03-take2.mp4')}
            readOnly
          />
        </Specimen>
        <Specimen label="禁用 / 报错" align="stretch">
          <DesignFileInput label="导入素材" placeholder="选择文件" disabled />
          <DesignFileInput label="导入素材" placeholder="选择文件" error="只支持 mp4 / mov" />
        </Specimen>
      </PrimitiveStage>
    ),
  },
  {
    id: 'pf-05-search-input',
    name: 'DesignSearchInput · sm / md × 空 / 有值',
    source: 'src/design/searchInput.tsx · docs/design/nomi-design-system.md §3.4',
    coverage: 'shell',
    render: () => (
      <PrimitiveStage>
        <Specimen label="size=sm（30px · 紧凑面板）" align="stretch">
          <Stateful initial="">
            {(value, set) => <DesignSearchInput value={value} onChange={set} placeholder="搜索项目" className="w-[240px]" />}
          </Stateful>
          <Stateful initial="海边">
            {(value, set) => <DesignSearchInput value={value} onChange={set} placeholder="搜索项目" className="w-[240px]" />}
          </Stateful>
        </Specimen>
        <Specimen label="size=md（36px · 宽松页面）" align="stretch">
          <Stateful initial="">
            {(value, set) => <DesignSearchInput size="md" value={value} onChange={set} placeholder="搜索素材" className="w-[280px]" />}
          </Stateful>
          <Stateful initial="逆光">
            {(value, set) => <DesignSearchInput size="md" value={value} onChange={set} placeholder="搜索素材" className="w-[280px]" />}
          </Stateful>
        </Specimen>
      </PrimitiveStage>
    ),
  },
]
