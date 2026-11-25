// 聊天里的指向元素（2026-10-23 D2 P1）：代表一个画布节点，点一下定位过去。
// 节点状态的说法（等你确认 / 排队中 / 生成中 / 失败原因 / 已停原因 / 可找回）不在这里另写——指向元素读的是节点自己的那几条
// （generationCommon.production.canvasLanding.*、生成反馈的话术、shotTable.status.recoverable），这里只放「节点上没有、只在指向元素上」的几句。
export const zhNodePointer = {
  /** 节点删掉了：只在指向元素上出现（宿主显式说了删才有）。 */
  deleted: '已删除',
  deletedHint: '画布上已没有这个节点',
  /** 点过、画布定位过去的那一项（回到对话后仍标着）。 */
  located: '已定位',
  /** 组指向超过露出的个数：点它展开成全部。 */
  more: '还有 {{count}} 个',
  moreCompact: '+{{count}}',
  moreAria: '还有 {{count}} 个，点了全部展开',
  /** 列表行那一组超过 4 行折起之后，下面那一行文字按钮（板 2026-11-15 chat.rows.more）：点了全部展开。 */
  moreShots_one: '还有 {{count}} 个镜头',
  moreShots_other: '还有 {{count}} 个镜头',
  /**
   * 窄窗口点了指向、对话收起之后，回来的那一颗：看得见的字（设计系统 §1.8 规则 3：中文 ≤4 字、英文 ≤2 词）。
   * 英文挑「Back」不挑「Chat」：Back 说的是动作（回去），回到哪儿由聊天图标（不带标签的那种）、悬停名和读屏名补；Chat 只有对象、没有动作。
   */
  backToChat: '回到对话',
  backToChatWithLabel: '{{label}} · 回到对话',
  /** 同一颗的读屏名 / 悬停名（不受 ≤2 词限制；英文写全「Back to chat」）。 */
  backToChatName: '回到对话',
  backToChatNameWithLabel: '{{label}} · 回到对话',
  /** 读屏念的名字：镜号 + 名字 + 状态；点了会去画布。失败时宿主给的结局（例如「没有发出去」）也念。 */
  aria: '{{name}}，{{status}}，点了在画布上定位',
  ariaOutcome: '{{name}}，{{status}}，{{outcome}}，点了在画布上定位',
  ariaPlain: '{{name}}，点了在画布上定位',
  ariaDeleted: '{{name}}，已删除',
  /** 节点此刻不在画布上、宿主也没说删（画布还在载入 / 撤销回放那一瞬）：不说已删除，只说现在定位不了。 */
  ariaUnavailable: '{{name}}，现在还定位不到',
  untitled: '未命名',
}

export const enNodePointer: typeof zhNodePointer = {
  deleted: 'Deleted',
  deletedHint: 'No longer on the canvas',
  located: 'Located',
  more: '{{count}} more',
  moreCompact: '+{{count}}',
  moreAria: '{{count}} more, show all',
  moreShots_one: '{{count}} more shot',
  moreShots_other: '{{count}} more shots',
  backToChat: 'Back',
  backToChatWithLabel: '{{label}} · Back',
  backToChatName: 'Back to chat',
  backToChatNameWithLabel: '{{label}} · Back to chat',
  aria: '{{name}}, {{status}}. Opens it on the canvas',
  ariaOutcome: '{{name}}, {{status}}, {{outcome}}. Opens it on the canvas',
  ariaPlain: '{{name}}. Opens it on the canvas',
  ariaDeleted: '{{name}}, deleted',
  ariaUnavailable: '{{name}}, can’t be located right now',
  untitled: 'Untitled',
}
