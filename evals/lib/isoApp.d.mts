// isoApp.mjs 的类型声明。
//
// 为什么需要它：`evals/**/*.test.ts` 会被 vitest 收，但 .ts 测试 import 这份 .mjs 时
// 拿不到声明 → TS7016 → check:test-types 记账（isoAppEnv.test.ts 长期挂着 1 处欠账）。
// 而测试文件**不进** `pnpm typecheck`，那道门是唯一看得见它们类型错的地方，所以别把它当噪音。
//
// 这里刻意用宽松的 Playwright 形状（unknown/Record）而不是 import 真类型：evals 走查驱动的
// win/app 句柄来自 playwright-core 的 Electron 分支，把它精确绑进来会让这份声明跟着
// Playwright 版本漂；这些函数的契约本来就是「给我一个能 evaluate/locator 的句柄」。
type PlaywrightPage = {
  evaluate: (...args: never[]) => Promise<unknown>
  locator: (...args: never[]) => unknown
  [key: string]: unknown
}

export declare const TOOL_WHITELIST: Set<string>

/**
 * 种子期版本闸：种子 schema 比被测构建新时抛错（拷进去必然只读 → 播种全失败 → 假绿）。
 * 返回种子版本号；读不到被测构建版本、或种子损坏/无版本号时返回 null（不判断，不臆断）。
 */
export declare function assertSeedUnderstoodByBuild(
  seedPath: string,
  buildVersion?: number | null,
): number | null

export declare function realCatalogPath(): string

export declare function prepareIsolation(
  isoDir: string,
  options?: { requireCatalog?: boolean },
): { projectsDir: string; settingsDir: string; chromiumDir: string }

export declare function isolatedAppEnv(
  iso: { projectsDir: string; settingsDir: string; chromiumDir: string },
  baseEnv?: Record<string, string | undefined>,
): Record<string, string>

export declare function launchIsolatedApp(
  repoRoot: string,
  iso: { projectsDir: string; settingsDir: string; chromiumDir: string },
): Promise<{ app: Record<string, unknown>; win: PlaywrightPage }>

export declare function dismissSplashIfPresent(win: PlaywrightPage): Promise<void>
export declare function createBlankProject(win: PlaywrightPage, projectsDir: string): Promise<string>
export declare function openGenerationAiPanel(win: PlaywrightPage): Promise<void>
export declare function setAssistantModelPref(win: PlaywrightPage, pref: unknown): Promise<void>
export declare function readAssistantModelLabel(win: PlaywrightPage): Promise<string>
export declare function sendAgentMessage(win: PlaywrightPage, message: string): Promise<void>

export declare function readEventsLog(projectDir: string): Array<Record<string, unknown>>
export declare function readProjectPayload(projectDir: string): Record<string, unknown> | null
export declare function countFinishedTurns(events: Array<Record<string, unknown>>): number
export declare function newFinishedTurn(
  events: Array<Record<string, unknown>>,
  baselineTurnCount?: number,
): Record<string, unknown> | null

export declare function approveUntilTurnEnds(
  win: PlaywrightPage,
  projectDir: string,
  options?: { timeoutMs?: number; log?: (message: string) => void; baselineTurnCount?: number },
): Promise<unknown>

export declare function waitForPersistedCanvas(
  win: PlaywrightPage,
  projectDir: string,
  options?: { settleMs?: number; timeoutMs?: number },
): Promise<unknown>
