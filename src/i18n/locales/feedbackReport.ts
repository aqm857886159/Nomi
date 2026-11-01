// 一键反馈那张卡的文案（样张 B，用户 09-15 已拍板）。
//
// 写这些句子时守的两条：
//   ① **不解释我们不是坏人，而是直接说清收什么**。用户原话要求「让用户理解我们不是做坏事
//      只是为了真实优化产品」——做到这件事的不是一段承诺，是一行看得见的清单（「查看」）。
//      所以这里没有「我们非常重视您的隐私」这类句子，只有事实。
//   ② **零输入**。唯一的可填位是 notePlaceholder 那一行，它的文案本身就在说「可不填」。
//
// 清单的条目和原因按主进程的契约表穷尽（`satisfies`）：清单是同意书，界面是什么语言它就得是什么语言，
// 主进程多写一项而这里没译文，编译就红。
import type { FeedbackExclusionReason, FeedbackManifestItem } from '../../../electron/shared/contracts/feedback'

export const zhFeedbackReport = {
  title: '反馈这个问题',
  /** 没有失败可说时的那一句（设置 → 关于 → 反馈）。四个失败面都带自己的那句人话，不走这里。 */
  summaryFallback: '你主动发起的反馈',
  attachesLead: '附带',
  attachItem: {
    logs: '日志',
    catalog: '模型目录',
    trace: '工具轨迹',
    perf: '卡顿数字',
  },
  view: '查看',
  manifestLoading: '正在整理清单…',
  manifestUnavailable: '清单这次没算出来（日志或轨迹暂时读不到）。仍然可以发送。',
  manifestItem: {
    logTail: '最近的运行日志：只留时间、模块、事件名和状态码这类数字，其余字段不带',
    modelCatalog: '模型目录：接了哪几家、官方地址和模型配置；自建连接只留「是自建」，不带地址；密钥、代理地址、自定义头全部抹掉',
    trajectory: '最近 3 个回合用了哪些工具、成没成功、多久、多少 token；提示词、回复、工具结果都不带',
    perf: '界面流畅度的分档数字：没有原始毫秒，没有内容',
    secrets: '密钥、令牌、代理凭据',
    paths: '文件路径、项目路径、素材路径',
    content: '提示词、回复、文稿、工具结果',
    fullLogs: '完整日志、Agent 命令账本、项目文件',
  } satisfies Record<FeedbackManifestItem, string>,
  manifestTrajectoryWithContent: '最近 3 个回合用了哪些工具、成没成功、多久、多少 token，外加你勾选的提示词和回复（每段只取开头一小段）；文稿和工具结果仍然不带',
  manifestWhy: {
    'logs-unavailable': '这次没读到',
    'logs-empty': '这次还没有日志',
    'catalog-unavailable': '这次没读到',
    'no-conversation-in-context': '这个问题不在对话里',
    'trajectory-unavailable': '这次没读到',
    'trajectory-timeout': '读得太久，这次不等了',
    'perf-unavailable': '这次还没攒够数据',
    'report-size-limit': '超过大小上限',
    'never-collected-by-design': '从不收集',
    'content-checkbox-not-ticked': '没勾选',
    'available-only-via-settings-diagnostics-export': '只能自己从「导出诊断包」导出',
  } satisfies Record<FeedbackExclusionReason, string>,
  rawHint: '要看完整原文：设置 → 通用 → 导出诊断包。',
  includeContent: '也附带最近几轮的提示词和回复（各取开头一小段）',
  notePlaceholder: '补一句（可不填）',
  send: '发送',
  sending: '正在发送…',
  sent: '已发送',
  sentWithId: '已发送 {{id}}',
  queued: '这次没连上，已存在本机，之后会自动重发',
  trimmedNote: '有附件超过大小上限，没带上。',
  unconfigured: '这个构建没有配反馈接收端，所以发不出去。可以改用「设置 → 通用 → 导出诊断包」，把文件发给我们。',
  failed: '这次没能确认发出去，可以再点一次发送。',
  bridgeMissing: '这个窗口没有桌面桥，发不出去（浏览器实验室 / 未打包）',
}

export const enFeedbackReport = {
  title: 'Report this problem',
  summaryFallback: 'Feedback you started',
  attachesLead: 'Attaches',
  attachItem: {
    logs: 'logs',
    catalog: 'model catalog',
    trace: 'tool trace',
    perf: 'slowness figures',
  },
  view: 'View',
  manifestLoading: 'Preparing the list…',
  manifestUnavailable: 'The manifest could not be built this time (logs or trace are unreadable right now). You can still send.',
  manifestItem: {
    logTail: 'Recent app logs: only the time, module, event name and figures such as status codes. Other fields stay out',
    modelCatalog: 'Model catalog: which providers are connected, their official addresses and model settings. A self-hosted connection is only marked as self-hosted, with no address. Keys, proxy addresses and custom headers are wiped',
    trajectory: 'The last 3 turns: which tools ran, whether they worked, how long, how many tokens. No prompts, replies or tool results',
    perf: 'Banded interface smoothness figures: no raw timings, no content',
    secrets: 'API keys, tokens, proxy credentials',
    paths: 'File, project and asset paths',
    content: 'Prompts, replies, manuscripts, tool results',
    fullLogs: 'Full logs, the Agent command ledger, project files',
  } satisfies Record<FeedbackManifestItem, string>,
  manifestTrajectoryWithContent: 'The last 3 turns: which tools ran, whether they worked, how long, how many tokens, plus the prompts and replies you ticked (the start of each). Manuscripts and tool results stay out',
  manifestWhy: {
    'logs-unavailable': 'Could not be read this time',
    'logs-empty': 'No logs yet',
    'catalog-unavailable': 'Could not be read this time',
    'no-conversation-in-context': 'This problem is not in a conversation',
    'trajectory-unavailable': 'Could not be read this time',
    'trajectory-timeout': 'Took too long to read, so it was skipped this time',
    'perf-unavailable': 'Not enough data yet',
    'report-size-limit': 'Over the size limit',
    'never-collected-by-design': 'Never collected',
    'content-checkbox-not-ticked': 'Not ticked',
    'available-only-via-settings-diagnostics-export': 'Only through your own diagnostics export',
  } satisfies Record<FeedbackExclusionReason, string>,
  rawHint: 'For the full raw files: Settings → General → Export a diagnostics bundle.',
  includeContent: 'Also attach recent prompts and replies (the start of each)',
  notePlaceholder: 'Add a line (optional)',
  send: 'Send',
  sending: 'Sending…',
  sent: 'Sent',
  sentWithId: 'Sent {{id}}',
  queued: 'Could not reach Nomi just now. Saved on this computer; it will be sent automatically.',
  trimmedNote: 'Some attachments were over the size limit and were left out.',
  unconfigured: 'This build has no feedback endpoint configured, so nothing can be sent. You can use Settings → General → Export a diagnostics bundle and send us the file instead.',
  failed: 'We could not confirm it went through. You can press Send again.',
  bridgeMissing: 'This window has no desktop bridge, so nothing can be sent (browser lab / unpackaged)',
} satisfies TranslationShape<typeof zhFeedbackReport>

type TranslationShape<T> = {
  [K in keyof T]: T[K] extends string ? string : TranslationShape<T[K]>
}
