// 「走查绕开 _shell.mjs 自己手抄外壳位置」的判定逻辑（check-walkthroughs.mjs 的 raw-shell-anchor 规则）。
// 抽成独立模块只为可单测（check-walkthroughs.mjs 一 import 就跑整道门岗）。
//
// 为什么要这条规则（2026-10-09，#1136 外壳重设计 CI 全红）：「返回项目库」钮抄了 15 处、Agent 面板的展开 / 收起选择器抄了十几处，
// 外壳一换，没人能一次改全，剩下的全部悬空成假红。外壳位置的唯一出口是 tests/ux/_shell.mjs，
// 其余走查要经过这些位置，一律调它的函数；再手抄就是下一次大面积悬空的种子。
//
// 只盯「为了到达别处而经过的外壳位置」那几串字面量。走查自己要验的外壳细节（几何 / 快捷键 / 拖动）不在其内。

/** 外壳位置的字面量写法。每条 = [正则, 该走哪个出口]。 */
export const RAW_SHELL_PATTERNS = [
  [/getByRole\(\s*['"]button['"]\s*,\s*\{\s*name:\s*(?:\/[^/\n]*|['"])(?:返回项目库|Back to projects)/, 'backToLibrary()'],
  [/\[data-v4-control="(?:collapse|dock-open)"\]/, 'collapseAgentPanel() / ensureAgentPanelOpen()'],
  [/\[data-agent-resident="true"\]\[data-agent-(?:panel|collapsed)="true"\]/, 'AGENT_PANEL / COLLAPSED_SHELL（_shell.mjs 导出）'],
  [/(?:getByText|getByRole|locator)\([^)]*新建空白项目/, 'newProjectEntry()'],
  [/data-testid="open-model-settings"|aria-label="打开模型设置"|name:\s*(?:\/|')打开模型设置/, 'openModelSettings() / modelSettingsEntry()'],
]

/**
 * 不能 import 的场景，登记在这里（路径 → 为什么）。新增条目要写得出「为什么 import 不了」。
 */
export const RAW_SHELL_EXEMPT = new Map([
  ['tests/ux/_shell.mjs', '出口本身：这些串就是它定义的'],
  ['tests/ux/full-walk/pageProbe.mjs', '页内探针：整段在浏览器里 evaluate，拿不到 Node 侧 import'],
  ['tests/ux/first-launch-system-locale.walk.mjs', '专门验空库首屏随系统语言出哪种文案：newProjectEntry 中英都认，会让这条断言失去判别力'],
  ['tests/ux/library-language-switcher.walk.mjs', '专门验库页切语言后的文案：同上，不能用中英都认的助手'],
  ['tests/ux/pr720-language-switch-mid-session.walk.mjs', '专门验会话中切语言后库页文案：同上'],
  ['tests/ux/smoke.e2e.mjs', '专门验空库首屏主入口动作卡片本身（data-variant=primary），不是借它进项目'],
  ['tests/ux/memory.e2e.mjs', 'CDP 裸页面脚本，没有 Playwright locator，点按钮靠页内 DOM 脚本'],
])

/**
 * @param {string} code 走查源码（已剥注释）
 * @returns {{ line: number, text: string, use: string }[]}
 */
export function findRawShellAnchors(code) {
  const hits = []
  code.split('\n').forEach((line, index) => {
    for (const [pattern, use] of RAW_SHELL_PATTERNS) {
      if (pattern.test(line)) hits.push({ line: index + 1, text: line.trim().slice(0, 120), use })
    }
  })
  return hits
}
