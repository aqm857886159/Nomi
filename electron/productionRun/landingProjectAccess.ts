// 派发前落地要的项目，怎么拿到、拿到之后怎么一直确认它还算数（架构③ Q1，用户 2026-10-09 拍板 A + C′）。
//
// 只有一种情况替用户打开：主窗口本来就是隐藏的、用户从没把它叫出来（外部 MCP 冷启的后台实例）。那时没有人在看这个
// 窗口，让它经现有的 `nomi:production-deep-link` 通道打开目标项目，再走同一个准入点落地、派发——只有一个窗口，
// 不会两份渲染层抢写同一个项目文件，也不新增任何可见界面。
//
// 其余一律拒（不派、停在 landing_failed）：
//   (a) 用户看得见的窗口开着别的项目——**绝不切换用户正在看的项目**；
//   (b) 没有渲染层的旧进程内 stdio 路（`refuseLandingWithoutRenderer`）。
// 拒绝时带上项目名，回给 Agent 的话如实说「需要在 Nomi 里打开项目「X」后再继续」。
//
// ── 为什么是「租约」而不是一次检查（#1139 对抗评审 B2）──
// 打开项目、hydrate、认下项目、再落地，中间隔着好几个 await。入口那一刻窗口是隐藏的，不代表 hydrate 完的那一刻
// 它还是：用户可能把窗口叫了出来（接管了它）、切到了别的项目、窗口被重建了。所以拿到项目时同时拿到一份租约，
// 记下「窗口代次 + 是否仍对用户隐藏 + 此刻开着的项目」；发 deep-link 之前、认下项目之后、落地（materialize）之前、
// 写回绑定之前都再核一次——任何一项变了，这次落地就取消（landing_failed，派发 0 次），绝不在用户眼前继续改画布。

export class LandingProjectNotOpenError extends Error {
  readonly code = "landing_project_not_open";
  constructor(readonly projectId: string, readonly projectName: string | undefined) {
    super(`landing_project_not_open: ${projectId}`);
    this.name = "LandingProjectNotOpenError";
  }
}

/** 拿项目之后被收回（窗口被叫出来 / 换了项目 / 窗口重建）：这次落地取消，什么都不写。 */
export class LandingLeaseRevokedError extends Error {
  readonly code = "landing_lease_revoked";
  constructor(readonly projectId: string, readonly why: "window_shown" | "project_changed" | "window_replaced", readonly projectName?: string) {
    super(`landing_lease_revoked: ${why}`);
    this.name = "LandingLeaseRevokedError";
  }
}

/** 一次派发前落地手里的那份项目访问。`isCurrent` 给落地链做栅栏，`assertCurrent` 不成立就抛。 */
export type LandingProjectLease = Readonly<{
  projectId: string;
  isCurrent: () => boolean;
  assertCurrent: () => void;
}>;

export type LandingProjectAccess = (projectId: string) => Promise<LandingProjectLease>;

export type LandingProjectAccessDeps = Readonly<{
  /** 主进程此刻认下的那个项目（窗口里真正开着的；没有 = null）。 */
  committedProjectId: () => string | null;
  /** 主窗口此刻隐藏、而且用户从没把它叫出来过（后台冷启的实例）。用户见过的窗口一律算「有人在看」。 */
  mainWindowHiddenFromUser: () => boolean;
  /** 主窗口的代次：窗口被重建或被叫出来都会变（backgroundLaunch.backgroundWindowEpoch）。 */
  windowEpoch: () => number;
  /** 让那个隐藏主窗口打开这个项目（不显示窗口、不抢焦点）。 */
  openInHiddenWindow: (projectId: string) => void;
  projectName: (projectId: string) => string | undefined;
  sleep: (ms: number) => Promise<void>;
  /** 等隐藏窗口认下项目最多多久（落地那头的 RPC 期限是 60s，这里先用掉一半）。 */
  timeoutMs?: number;
  pollMs?: number;
}>;

/** (b) 没有渲染层的进程内 stdio 路：落不了画布，一律拒（带项目名）。 */
export function refuseLandingWithoutRenderer(projectName: (projectId: string) => string | undefined): LandingProjectAccess {
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

/** 项目本来就开着（用户自己开的，或之前已经认下的）：租约只看「它还开着」。 */
export function openProjectLease(projectId: string, committedProjectId: () => string | null): LandingProjectLease {
  const isCurrent = () => committedProjectId() === projectId;
  return {
    projectId,
    isCurrent,
    assertCurrent: () => { if (!isCurrent()) throw new LandingLeaseRevokedError(projectId, "project_changed"); },
  };
}

export function createLandingProjectAccess(deps: LandingProjectAccessDeps): LandingProjectAccess {
  const timeoutMs = deps.timeoutMs ?? 30_000;
  const pollMs = deps.pollMs ?? 100;
  return async (projectId) => {
    if (deps.committedProjectId() === projectId) return openProjectLease(projectId, deps.committedProjectId);
    const refuse = () => new LandingProjectNotOpenError(projectId, deps.projectName(projectId));
    if (!deps.mainWindowHiddenFromUser()) throw refuse();
    // 租约：窗口代次 + 仍对用户隐藏 + 窗口里开着的项目。打开之前它开着的是 `before`，认下之后必须是目标项目。
    const epoch = deps.windowEpoch();
    const before = deps.committedProjectId();
    const why = (expectProject: string | null): LandingLeaseRevokedError["why"] | null => {
      if (deps.windowEpoch() !== epoch) return "window_replaced";
      if (!deps.mainWindowHiddenFromUser()) return "window_shown";
      if (deps.committedProjectId() !== expectProject) return "project_changed";
      return null;
    };
    const fence = (expectProject: string | null): void => {
      const revoked = why(expectProject);
      if (revoked) throw new LandingLeaseRevokedError(projectId, revoked, deps.projectName(projectId));
    };
    // ① 发 deep-link 之前：入口检查之后、真正改窗口之前，再核一次。
    fence(before);
    deps.openInHiddenWindow(projectId);
    // ② 打开是渲染层异步做的（hydrate 完、主进程认下这个项目才算开着）：等它认下；等待期间窗口被叫出来 / 被重建，
    //    立刻取消（不等到超时）。认下了别的项目（用户在 hydrate 中途切走）同样取消。
    for (let waited = 0; deps.committedProjectId() !== projectId; waited += pollMs) {
      const revoked = why(deps.committedProjectId());
      if (revoked && revoked !== "project_changed") throw new LandingLeaseRevokedError(projectId, revoked, deps.projectName(projectId));
      if (deps.committedProjectId() !== before && deps.committedProjectId() !== null) throw new LandingLeaseRevokedError(projectId, "project_changed", deps.projectName(projectId));
      if (waited >= timeoutMs) throw refuse();
      await deps.sleep(pollMs);
    }
    // ③ 认下之后：仍是同一代、仍隐藏、开着的就是目标项目。
    fence(projectId);
    const isCurrent = () => why(projectId) === null;
    return { projectId, isCurrent, assertCurrent: () => fence(projectId) };
  };
}
