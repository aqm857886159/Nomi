// 派发前落地要的项目此刻没打开时怎么办（架构③ Q1，用户 2026-10-09 拍板 A + C′）。
//
// 只有一种情况替用户打开：主窗口本来就是隐藏的、用户从没把它叫出来（外部 MCP 冷启的后台实例）。那时没有人在看这个
// 窗口，让它经现有的 `nomi:production-deep-link` 通道打开目标项目，再走同一个准入点落地、派发——只有一个窗口，
// 不会两份渲染层抢写同一个项目文件，也不新增任何可见界面。
//
// 其余一律拒（不派、停在 landing_failed）：
//   (a) 用户看得见的窗口开着别的项目——**绝不切换用户正在看的项目**；
//   (b) 没有渲染层的旧进程内 stdio 路（不给本模块，宿主直接拒）。
// 拒绝时带上项目名，回给 Agent 的话如实说「需要在 Nomi 里打开项目「X」后再继续」。

export class LandingProjectNotOpenError extends Error {
  readonly code = "landing_project_not_open";
  constructor(readonly projectId: string, readonly projectName: string | undefined) {
    super(`landing_project_not_open: ${projectId}`);
    this.name = "LandingProjectNotOpenError";
  }
}

export type LandingProjectAccessDeps = Readonly<{
  isProjectOpen: (projectId: string) => boolean;
  /** 主窗口此刻隐藏、而且用户从没把它叫出来过（后台冷启的实例）。用户见过的窗口一律算「有人在看」。 */
  mainWindowHiddenFromUser: () => boolean;
  /** 让那个隐藏主窗口打开这个项目（不显示窗口、不抢焦点）。 */
  openInHiddenWindow: (projectId: string) => void;
  projectName: (projectId: string) => string | undefined;
  sleep: (ms: number) => Promise<void>;
  /** 等隐藏窗口认下项目最多多久（落地那头的 RPC 期限是 60s，这里先用掉一半）。 */
  timeoutMs?: number;
  pollMs?: number;
}>;

/** (b) 没有渲染层的进程内 stdio 路：落不了画布，一律拒（带项目名）。 */
export function refuseLandingWithoutRenderer(projectName: (projectId: string) => string | undefined): (projectId: string) => Promise<void> {
  return async (projectId) => {
    let name: string | undefined;
    try {
      name = projectName(projectId);
    } catch {
      name = undefined;
    }
    throw new LandingProjectNotOpenError(projectId, name);
  };
}

export function createLandingProjectAccess(deps: LandingProjectAccessDeps): (projectId: string) => Promise<void> {
  const timeoutMs = deps.timeoutMs ?? 30_000;
  const pollMs = deps.pollMs ?? 100;
  return async (projectId) => {
    if (deps.isProjectOpen(projectId)) return;
    const refuse = () => new LandingProjectNotOpenError(projectId, deps.projectName(projectId));
    if (!deps.mainWindowHiddenFromUser()) throw refuse();
    deps.openInHiddenWindow(projectId);
    // 打开是渲染层异步做的（hydrate 完、主进程认下这个项目才算开着）：等它认下，等不到就如实拒。
    for (let waited = 0; !deps.isProjectOpen(projectId); waited += pollMs) {
      if (waited >= timeoutMs) throw refuse();
      await deps.sleep(pollMs);
    }
  };
}
