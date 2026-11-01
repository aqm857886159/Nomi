// 一键反馈的 Electron 那一半：取料（日志 / 模型目录 / 轨迹）、发送、返回编号。
//
// 两件事在这里定死，别挪进渲染层：
//   ① **不受「帮 Nomi 变好」开关管**（2026-09-15 用户拍板④：反馈是他主动点的）。
//      所以这里一个字都不读 `readTelemetrySettings()`。
//   ② **永不阻塞 UI，也不丢**：报告先落盘再发，界面最多等几秒，发不出去后台接着重试。
import { app, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { assertTrustedSender } from '../ipcSenderGuard'
import { getSettingsRoot } from '../settings/settingsRoot'
import { logsDir } from '../logging/logFiles'
import { logError } from '../logging/logger'
import { getWorkspaceRepositoryDeps } from '../runtimePaths'
import { resolveWorkspaceProjectDir } from '../workspace/workspaceRepository'
import { getDesktopLocale } from '../desktopLocale'
import { intakeConfigured } from '../telemetry/intakeClient'
import { flushIntakeQueue, setIntakeTooLargeHandler } from '../telemetry/intakeQueue'
import type { TrajectoryTurnInput } from '../shared/agentLane/laneTrajectory'
import type { FeedbackReportPreview, FeedbackSendResult } from '../shared/contracts/feedback'
import { readRecentLogLines } from './feedbackLogTail'
import { buildFeedbackReport, isFeedbackReportRequest, shrinkFeedbackReport, type FeedbackReportDeps } from './feedbackReport'
import { sendFeedbackReport } from './feedbackSend'

function readModelCatalog(): unknown | null {
  try {
    const file = path.join(getSettingsRoot(), 'model-catalog.json')
    return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
  } catch {
    // 解不出来就整份不带：解不出来就保证不了脱敏（diagnosticsBundle.ts 的同一条判断）。
    return null
  }
}

async function readTrajectory(laneName: string, projectId: string | null): Promise<TrajectoryTurnInput[] | null> {
  // 项目由**请求带来**（发起的那个面知道自己在哪个项目）。主进程这一侧不读「当前项目」：
  // 2026-09-17 起它在主进程没有读者，而且那种读法会把「点反馈时正开着的项目」当成
  // 「这条失败所在的项目」。拿不到 projectId = 不带轨迹，清单里写明 why。
  if (!projectId) return null
  const projectDir = resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps())
  if (!projectDir) return null
  // 跨编译岛只走这座桥（pi 是 ESM-only）。桥的返回类型就是形状漂移守卫。
  // 这里**不再**自己包 try/catch：`buildFeedbackReport` 已经把抛出的 readTrajectory 记成
  // `trajectory-unavailable` 写进清单（`feedbackReport.test.ts` 有那一条）。包两层的结果是
  // 外层先吞掉，清单里那条 why 永远写不出来。
  // 形状在这里**手抄一遍**，不是 `typeof import('...laneNativeLoader.cjs')`——试过，不行：
  // 那样会把 ESM 岛（`electron/tsconfig.pi.json` 那半）的 .mts 拖进 CommonJS 这半的程序，
  // 整片 `Cannot find module '@earendil-works/pi-agent-core/harness/...'`。
  // 所以真正的漂移守卫**不在这一行**，在桥那一侧：`laneNativeLoader.cts` 把它声明成返回
  // `TrajectoryTurnInput[]`，岛里的 `LaneTraceTurn` 一旦不再结构兼容，编译在那边当场红。
  // 这里抄的这份只保证「我按这个形状用它」。
  const native = createRequire(__filename)('../agentLane/laneNativeLoader.cjs') as {
    readLaneTraceTurns(projectDir: string, laneName: string): Promise<TrajectoryTurnInput[]>
  }
  return await native.readLaneTraceTurns(projectDir, laneName)
}

/**
 * 每次请求现取一份 deps：`projectId` 从**这次请求**里来（发起的那个面知道自己在哪个项目），
 * 不是进程里某个「当前项目」。两个调用点（preview / send）都传同一个值，所以清单里写的项目
 * 与轨迹取自的项目一定是同一个。
 */
function reportDeps(projectId: string | null): FeedbackReportDeps {
  return {
    now: new Date(),
    app: {
      version: app.getVersion(),
      electron: process.versions.electron ?? 'unknown',
      node: process.versions.node ?? 'unknown',
      chrome: process.versions.chrome ?? 'unknown',
    },
    system: {
      platform: process.platform,
      arch: process.arch,
      osRelease: process.getSystemVersion?.() ?? '',
      locale: getDesktopLocale(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
    },
    projectId,
    readLogTail: (maxLines) => readRecentLogLines(logsDir(), maxLines),
    readModelCatalog,
    readTrajectory: (laneName) => readTrajectory(laneName, projectId),
  }
}

export function registerFeedbackIpc(): void {
  // 「查看」：把清单给他看。每项一行 what，没带的一行 why。不发任何东西。
  ipcMain.handle('nomi:feedback:preview', async (event, payload: unknown): Promise<FeedbackReportPreview | null> => {
    assertTrustedSender(event)
    if (!isFeedbackReportRequest(payload)) return null
    const report = await buildFeedbackReport(payload, reportDeps(payload.projectId ?? null))
    return { manifest: report.manifest }
  })

  ipcMain.handle('nomi:feedback:send', async (event, payload: unknown): Promise<FeedbackSendResult> => {
    assertTrustedSender(event)
    if (!isFeedbackReportRequest(payload)) return { ok: false, reason: 'invalid' }
    // 这个构建没配接收端就是真的发不出去。跟用户说「已排队」等于骗他（D4：缺口明着标）。
    if (!intakeConfigured()) return { ok: false, reason: 'endpoint-unconfigured' }

    const report = await buildFeedbackReport(payload, reportDeps(payload.projectId ?? null)).catch((error: unknown) => {
      logError('diagnostics', 'feedback-build-failed', error)
      return null
    })
    if (!report) return { ok: false, reason: 'failed' }
    return sendFeedbackReport(report)
  })

  setIntakeTooLargeHandler('feedback', shrinkFeedbackReport)
  // 上次没发出去的在这里补发掉（App 起来时注册一次就够）。失败无声——用户已经拿到过回执。
  void flushIntakeQueue('feedback')
}
