import { clearHistory } from '../generationCanvas/events/canvasUndoJournal'
import { clearClipboard } from '../generationCanvas/store/canvasClipboard'
import { clearCommittedProposal } from '../generationCanvas/agent/proposalUndo'
import { resetClientIdRegistry } from '../generationCanvas/agent/clientIdRegistry'
import { clearPendingRetryImports } from '../generationCanvas/adapters/assetImportAdapter'
import { abandonPendingCanvasWrite } from '../generationCanvas/events/canvasWriteBoundary'
import { invalidateAgentTurnStates } from '../ai/agentTurnLifecycle'
import { storeLifetimeRegistry } from './storeLifetime'
import { flushPendingAssetDeletions } from '../assets/deleteAssetResult'
// 注册是 import 的副作用：每个 store 文件在模块顶层调 `declareStoreLifetime` 把自己登记进来。
// 这里逐个 import 而不是靠「反正别处也会 import 到」——打包器只保留被引用的模块，
// 少一条 import 就少清一个 store，而那种漏法**不会报错**，只会在用户切项目时露出来。
// `check:store-lifetime` 保证每个 store 都有声明，这份清单保证每份声明都被装载。
import '../ai/agentUsageStore'
import '../ai/residentActivity'
import '../generationCanvas/agent/shotVerifyStore'
import '../generationCanvas/components/batchPlanPreview'
import '../generationCanvas/runner/generationQueueStore'
import '../generationCanvas/spend/spendConfirm'
import '../generationCanvas/store/assetImportProgressStore'
import '../generationCanvas/store/canvasMenuPreferenceStore'
import '../generationCanvas/store/generationCanvasStore'
import '../generationCanvas/store/nodeLivePreviewStore'
import '../onboarding/journeyTourStore'
import '../production/productionCanvasLandingStore'
import '../production/productionRunStore'
import '../workbenchStoreLifetime'

/**
 * 离开当前项目时，把**归项目会话管**的渲染层状态释放掉（内容已经落过盘）。
 *
 * 刻意不是一个 store action：离开项目库不该 bump `persistRevision`、更不该写一个空项目。
 *
 * 2026-09-18（C1）起，**它不再自己知道要清哪些字段**。以前这里是两份手写清单
 * （`useWorkbenchStore` 21/31、`useGenerationCanvasStore` 10/13），而这个函数本身是
 * `0e1be560a`「reduce canvas memory usage」的副产品——它是为了省内存写的，不是为了当
 * 「项目会话 owner」写的。后果：加字段的人没有任何机器提示要不要清它，于是上一个项目的
 * 付费待确认卡、素材导入进度、常驻活动角标、分镜规划入口就留在了新项目里
 * （审计 `docs/audit/2026-09-17-ownership-lifetime-census.md` §1.1）。
 *
 * 现在每个字段的寿命写在它自己 store 旁边（`declareStoreLifetime`），这里只做一件事：
 * 把注册表里每一条 `releaseProject` 依次调一遍。`check:store-lifetime` 反过来拦住
 * 「字段没声明寿命」「声明了 project 却给不出 releaseProject」「这里又出现手写 setState」。
 */
export function releaseWorkbenchProjectRuntimeState(): void {
  void flushPendingAssetDeletions()
  invalidateAgentTurnStates()
  abandonPendingCanvasWrite()
  clearCommittedProposal()
  resetClientIdRegistry()
  clearHistory()
  clearClipboard()
  clearPendingRetryImports()

  for (const declaration of storeLifetimeRegistry()) declaration.releaseProject?.()
}
