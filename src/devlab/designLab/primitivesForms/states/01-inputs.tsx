// 设计实验室 · primitive 陈列 · 输入族。
//
// `Design*` 输入件全部是 Mantine 原语外裹一层 token className（`src/design/forms.tsx`）。
//
// ⚠️ 2026-09-07 整屏重做（用户抓到的系统性缺陷）：陈列格「渲染的是现役组件本体」这句话
// 只管住了**组件**，管不住 **props**——夹具作者编一组 props，就能让一格「技术上是真组件」
// 却完全不像真实使用，而它顶着「这是真组件」的名义比手画样张**更**误导。
// 这一屏此前四格全中：`label` + `description` + `defaultValue` 的 Mantine 标准布局在本仓
// **一处都没有**（生产一律自己包 `Field`/`<label>`、受控 `value`+`onChange`、报错走兄弟
// `<ErrorText>`）；NumberInput 画着上下箭头，而 5 个真实调用点全部 `hideControls`。
// 现在每格钉住的是**真实调用点的形状**，`mirrors` 字段写明镜像哪一行（门岗第五项验它）。
//
// pf-04（DesignFileInput）于 2026-09-07 随组件删除：全仓零调用，而 App 里 13 处文件选择
// 走的都是「隐藏 <input type="file"> + 自己的按钮」，与 Mantine 的可见文本框形态不是一回事。
// 空号不补位（改 id 就要改基线文件名，会洗掉「同一格前后有没有变」这条线索）。
import React from 'react'
import {
  DesignCheckbox,
  DesignNumberInput,
  DesignSearchInput,
  DesignSwitch,
  DesignTextInput,
  DesignTextarea,
} from '../../../../design'
import { PrimitiveStage, Specimen, Stateful } from '../../primitives/primitivesLabKit'
import type { LabState } from '../../labScreen'

const SOURCE_FORMS = 'src/design/forms.tsx · docs/design/nomi-design-system.md §3 表单'

/**
 * 生产包字段的那层壳：`Field`（onboardingWizardSupport）与 `FieldLabel` + `<ErrorText>`
 * （CapabilityModeEditor）是同一个形状的两份实现——标题在**输入框外面**，报错在**下面**。
 * 陈列必须连这层壳一起画：只画光秃秃的输入框，就等于宣称 Mantine 的 `label`/`description`
 * 布局是本仓的形态，而它在生产里一次都没出现过。
 */
function FieldShell({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-caption font-medium text-nomi-ink-60">{label}</span>
      {children}
      {hint ? <span className="text-micro text-nomi-ink-40">{hint}</span> : null}
      {error ? <span className="text-micro text-nomi-danger">{error}</span> : null}
    </label>
  )
}

export const INPUT_STATES: readonly LabState[] = [
  {
    id: 'pf-01-text-input-four-states',
    name: 'DesignTextInput · 生产四态（受控 · 外挂标题 · 布尔报错 · 等宽/密码）',
    source: SOURCE_FORMS,
    mirrors: [
      'src/ui/onboarding/ProviderProxyField.tsx:19',
      'src/ui/onboarding/CapabilityModeEditor.tsx:85',
      'src/ui/onboarding/CustomCallEditor.tsx:715',
    ],
    coverage: 'shell',
    // 四格 = 四个真实形状，不是「Mantine 支持哪几个 prop」：
    //   ① 受控 + 外挂 Field 标题（20/20 真实调用点都受控，0 个用 defaultValue）；
    //   ② error 传**字符串**（少数派，2 处）——Mantine 自己画红字；
    //   ③ error 传 **boolean**（多数派，CapabilityModeEditor 里 14 处）——只出红边，
    //      文案由兄弟 <ErrorText> 出。两种约定并存本身就是生产侧的债，摆出来才看得见；
    //   ④ 等宽字体 + maxLength + type=password：真实调用点常年带着的三件，此前一件没画。
    render: () => (
      <PrimitiveStage>
        <Specimen label="① 受控 + 外挂标题/说明（Field 壳 · 20/20 真实调用点的形状）" align="stretch">
          <Stateful initial="https://proxy.local:7890">
            {(value, set) => (
              <FieldShell label="代理地址" hint="留空则直连供应商">
                <DesignTextInput
                  value={value}
                  onChange={(event) => set(event.currentTarget.value)}
                  placeholder="http://127.0.0.1:7890"
                />
              </FieldShell>
            )}
          </Stateful>
        </Specimen>
        <Specimen label="② error=字符串（Mantine 自己出红字 · 少数派 2 处）" align="stretch">
          <Stateful initial="not-a-url">
            {(value, set) => (
              <FieldShell label="代理地址">
                <DesignTextInput
                  value={value}
                  onChange={(event) => set(event.currentTarget.value)}
                  error="这不是一个合法的地址"
                />
              </FieldShell>
            )}
          </Stateful>
        </Specimen>
        <Specimen label="③ error=boolean（只出红边，文案走兄弟 ErrorText · 多数派 14 处）" align="stretch">
          <Stateful initial="">
            {(value, set) => (
              <FieldShell label="能力名称" error="不能为空">
                <DesignTextInput
                  value={value}
                  onChange={(event) => set(event.currentTarget.value)}
                  error={value.trim().length === 0}
                />
              </FieldShell>
            )}
          </Stateful>
        </Specimen>
        <Specimen label="④ 等宽 classNames / maxLength / type=password（真实调用点常带）" align="stretch">
          <Stateful initial="sk-a1b2c3d4e5f6">
            {(value, set) => (
              <FieldShell label="模型 ID">
                <DesignTextInput
                  value={value}
                  onChange={(event) => set(event.currentTarget.value)}
                  classNames={{ input: 'font-nomi-mono' }}
                  maxLength={64}
                />
              </FieldShell>
            )}
          </Stateful>
          <Stateful initial="sk-a1b2c3d4e5f6">
            {(value, set) => (
              <FieldShell label="API Key">
                <DesignTextInput
                  type="password"
                  value={value}
                  onChange={(event) => set(event.currentTarget.value)}
                />
              </FieldShell>
            )}
          </Stateful>
        </Specimen>
      </PrimitiveStage>
    ),
  },
  {
    id: 'pf-02-textarea-number',
    name: 'DesignTextarea（autosize 开/关）/ DesignNumberInput（无步进器）',
    source: SOURCE_FORMS,
    mirrors: [
      'src/ui/community/FeedbackShareContent.tsx:280',
      'src/ui/onboarding/CapabilityModeEditor.tsx:595',
      'src/ui/onboarding/CapabilityModeEditor.tsx:95',
    ],
    coverage: 'shell',
    // NumberInput 此前画着上下箭头步进器——而 **5/5** 真实调用点都 `hideControls`
    // + `withKeyboardEvents={false}`，且值是**字符串**（`String(value)` 写回）。
    // 换句话说本仓的 NumberInput 是一个「不带控件、字符串背书的数字文本框」，
    // 那才是要钉住的形态；画着箭头的那版本仓一处都没有。
    render: () => (
      <PrimitiveStage>
        <Specimen label="Textarea · autosize 开 + minRows/maxRows 封顶（真实调用点都封顶）" align="stretch">
          {/* 这一格是本屏唯一走 Mantine 自带 `label` 的真实形状（反馈面板），
              逐项照抄 FeedbackShareContent:280：label + autosize + minRows/maxRows + error 字符串。 */}
          <Stateful initial={'黄昏的海边，少年逆光走向镜头。\n手持轻微晃动，暖色调。'}>
            {(value, set) => (
              <DesignTextarea
                label="一句话说清楚"
                placeholder="发生了什么"
                value={value}
                onChange={(event) => set(event.currentTarget.value)}
                autosize
                minRows={2}
                maxRows={4}
              />
            )}
          </Stateful>
        </Specimen>
        <Specimen label="Textarea · autosize={false} + rows=3 + resize（2/4 真实调用点显式关掉）" align="stretch">
          <Stateful initial="">
            {(value, set) => (
              <FieldShell label="能力说明" error="不能为空">
                <DesignTextarea
                  value={value}
                  onChange={(event) => set(event.currentTarget.value)}
                  error={value.trim().length === 0}
                  autosize={false}
                  rows={3}
                  resize="vertical"
                  maxLength={1000}
                />
              </FieldShell>
            )}
          </Stateful>
        </Specimen>
        <Specimen label="NumberInput · hideControls + withKeyboardEvents=false + 字符串值（5/5）" align="stretch">
          <Stateful initial="1">
            {(value, set) => (
              <FieldShell label="最小值">
                <DesignNumberInput
                  value={value}
                  allowDecimal={false}
                  hideControls
                  withKeyboardEvents={false}
                  onChange={(next) => set(String(next))}
                />
              </FieldShell>
            )}
          </Stateful>
          <Stateful initial="">
            {(value, set) => (
              <FieldShell label="最大值" error="不能为空">
                <DesignNumberInput
                  value={value}
                  error={value.trim().length === 0}
                  allowDecimal={false}
                  hideControls
                  withKeyboardEvents={false}
                  onChange={(next) => set(String(next))}
                />
              </FieldShell>
            )}
          </Stateful>
        </Specimen>
      </PrimitiveStage>
    ),
  },
  {
    id: 'pf-03-switch-checkbox',
    name: 'DesignSwitch · 生产三形（裸开关 / 自带 label / 禁用仍受控）+ DesignCheckbox 唯一真实用法',
    source: SOURCE_FORMS,
    mirrors: [
      'src/workbench/settings/AutomationPermissionsSection.tsx:204',
      'src/ui/onboarding/DirectScriptDraftForm.tsx:95',
      'src/workbench/settings/ScreenshotHotkeySection.tsx:51',
      'src/ui/onboarding/ModelPickerScreen.tsx:348',
    ],
    coverage: 'shell',
    // 真状态：点得动。挂空 handler 会让陈列变成一张骗人的图（见取景台头注纪律 2）。
    //
    // 三处此前失真，都已按真实调用点改回：
    //   · 主形态是**裸开关 + aria-label**（16 处里 12 处），文字归左边那行自己管；
    //     `label=` 是少数派（3 处），单独摆一格而不是当默认。
    //   · 禁用格此前写 `checked readOnly disabled`——这个组合生产**零实例**：
    //     两处真实禁用开关都仍绑着活的 `checked` + `onChange`（禁的是操作，不是数据）。
    //   · Checkbox 全仓**只有一个**调用点，而它是 `readOnly tabIndex={-1} aria-hidden` 的
    //     **装饰性对勾**（长在一个 <button> 行里）。此前画的三个「可点、带 label」的复选框
    //     一个都不存在——那是本屏最误导的一格。
    render: () => (
      <PrimitiveStage>
        <Specimen label="Switch · 裸开关 + aria-label，文字归左边那行（12/16 · 主形态）" align="stretch">
          <Stateful initial={true as boolean}>
            {(on, set) => (
              <div className="flex items-center justify-between gap-3">
                <span className="text-body-sm text-nomi-ink">允许自动读取项目文件</span>
                <DesignSwitch
                  size="sm"
                  aria-label="允许自动读取项目文件"
                  checked={on}
                  onChange={(event) => set(event.currentTarget.checked)}
                />
              </div>
            )}
          </Stateful>
          <Stateful initial={false}>
            {(on, set) => (
              <div className="flex items-center justify-between gap-3">
                <span className="text-body-sm text-nomi-ink">允许自动花费额度</span>
                <DesignSwitch
                  size="sm"
                  aria-label="允许自动花费额度"
                  checked={on}
                  onChange={(event) => set(event.currentTarget.checked)}
                />
              </div>
            )}
          </Stateful>
        </Specimen>
        <Specimen label="Switch · 自带 label + labelPosition=left（3/16 · 少数派）" align="stretch">
          <Stateful initial={true as boolean}>
            {(on, set) => (
              <DesignSwitch
                size="xs"
                labelPosition="left"
                label="生成后自动进入预览"
                checked={on}
                onChange={(event) => set(event.currentTarget.checked)}
              />
            )}
          </Stateful>
        </Specimen>
        <Specimen label="Switch · 禁用但仍受控（真实禁用开关不脱离数据）" align="stretch">
          <Stateful initial={true as boolean}>
            {(on, set) => (
              <div className="flex items-center justify-between gap-3">
                <span className="text-body-sm text-nomi-ink-40">截图快捷键（系统未授权）</span>
                <DesignSwitch
                  size="sm"
                  disabled
                  aria-label="截图快捷键"
                  checked={on}
                  onChange={(event) => set(event.currentTarget.checked)}
                />
              </div>
            )}
          </Stateful>
        </Specimen>
        <Specimen label="Checkbox · 全仓唯一用法：<button> 行里的装饰性对勾（aria-hidden）" align="stretch">
          {[
            { name: 'Seedream 4.5', added: true },
            { name: 'Nano Banana Pro', added: false },
          ].map((model) => (
            <button
              key={model.name}
              type="button"
              className="flex items-center gap-2 rounded-nomi border border-nomi-line px-2.5 py-2 text-left text-body-sm text-nomi-ink"
            >
              <DesignCheckbox checked={model.added} readOnly tabIndex={-1} aria-hidden />
              <span>{model.name}</span>
            </button>
          ))}
        </Specimen>
      </PrimitiveStage>
    ),
  },
  {
    id: 'pf-05-search-input',
    name: 'DesignSearchInput · sm / md × 空 / 有值',
    source: 'src/design/searchInput.tsx · docs/design/nomi-design-system.md §3.4',
    mirrors: [
      'src/workbench/assets/AssetLibraryToolbar.tsx:238',
      'src/workbench/library/LibraryDiscoveryToolbar.tsx:50',
    ],
    coverage: 'shell',
    // 补 `ariaLabel`：6 个真实调用点里 5 个都传，此前四格一个都没传——
    // 那等于陈列出一个「无障碍名字全靠 placeholder 兜底」的形态，而那是生产里的例外。
    render: () => (
      <PrimitiveStage>
        <Specimen label="size=sm（30px · 紧凑面板）" align="stretch">
          <Stateful initial="">
            {(value, set) => (
              <DesignSearchInput
                ariaLabel="搜索项目"
                value={value}
                onChange={set}
                placeholder="搜索项目"
                className="w-full min-w-0"
              />
            )}
          </Stateful>
          <Stateful initial="海边">
            {(value, set) => (
              <DesignSearchInput
                ariaLabel="搜索项目"
                value={value}
                onChange={set}
                placeholder="搜索项目"
                className="w-full min-w-0"
              />
            )}
          </Stateful>
        </Specimen>
        <Specimen label="size=md（36px · 宽松页面 · w-[280px] 同项目库）" align="stretch">
          <Stateful initial="">
            {(value, set) => (
              <DesignSearchInput
                size="md"
                ariaLabel="搜索素材"
                value={value}
                onChange={set}
                placeholder="搜索素材"
                className="w-[280px]"
              />
            )}
          </Stateful>
          <Stateful initial="逆光">
            {(value, set) => (
              <DesignSearchInput
                size="md"
                ariaLabel="搜索素材"
                value={value}
                onChange={set}
                placeholder="搜索素材"
                className="w-[280px]"
              />
            )}
          </Stateful>
        </Specimen>
      </PrimitiveStage>
    ),
  },
]
