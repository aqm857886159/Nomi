// 弹窗外壳上还挂着的存量 data-* 锚点（冻结名单：只许变短）。
//
// 2026-11-22 起找弹窗用角色 + 名字（`getByRole('dialog', { name })`）；名字会变、同名卡并存时才用外壳的 `testId`（→ data-testid）。
// 这里列的是还没迁走的旧锚点：要么消费方很多（几十个走查文件），要么生产代码在读（「生产在读」）。
// 走查那批等测试体系第 1 批合入后一起迁；生产在读的两处要先把读它的代码改成别的认法才能删。
//
// 新锚点挂不上：
// · `frozenAnchors` 的类型只认这里 on: 'dialog' 的名字（挂在对话框本体上）；
// · 直接写在 `<DesignModal>` 上的 data-*（落在弹窗根上）和 `closeButtonProps` 里的 data-*（落在关闭键上），
//   由 dialogAnchorFreeze.test.ts 扫源码：名单外的一出现就红；名单里的在源码里找不到了也红（删了就从这里删一行）。
export const FROZEN_DIALOG_ANCHORS = [
  { anchor: 'data-confirm-dialog', file: 'src/design/confirmDialog.tsx', on: 'root', readers: '走查页内查询 [data-confirm-dialog="…"] [role="dialog"]（3 个文件）' },
  { anchor: 'data-nomi-prompt-extraction-settings-dialog', file: 'src/ui/browser/prompt/BrowserPromptExtractionSettingsModal.tsx', on: 'dialog', readers: '生产在读：browserAssetPopoverConstants.ts 的 PROMPT_EXTRACTION_SETTINGS_DIALOG_SELECTOR' },
  { anchor: 'data-selection-prompt-ui', file: 'src/workbench/generationCanvas/components/SelectionPromptSaveController.tsx', on: 'dialog', readers: '生产在读：同文件 closest(\'[data-selection-prompt-ui="true"]\') 判断点击是不是落在保存卡里' },
  { anchor: 'data-settings-close', file: 'src/workbench/settings/SettingsDialog.tsx', on: 'close', readers: '走查 35 个文件' },
  { anchor: 'data-settings-dialog', file: 'src/workbench/settings/SettingsDialog.tsx', on: 'dialog', readers: '走查 21 个文件' },
  { anchor: 'data-settings-overlay', file: 'src/workbench/settings/SettingsDialog.tsx', on: 'dialog', readers: '走查 14 个文件' },
  { anchor: 'data-spend-confirm-dialog', file: 'src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx', on: 'dialog', readers: '走查 67 个文件（按取值分门类）' },
] as const

type FrozenEntry = (typeof FROZEN_DIALOG_ANCHORS)[number]
/** 还能经 `frozenAnchors` 挂在对话框本体上的锚点名。 */
export type FrozenDialogAnchor = Extract<FrozenEntry, { on: 'dialog' }>['anchor']
