import type { ProjectBinding } from "../shared/projectBinding";
import { assertProjectAgentBinding } from "./projectAgentIdentity";
import {
  createProjectAgentExecutionCoordinator,
  type ProjectAgentExecutionCoordinator,
} from "./projectAgentExecutionCoordinator";
import type { ProjectAgentRepositoryRouter } from "./projectAgentRepositoryRouter";

export class ProjectAgentOwnerConflictError extends Error {
  readonly code = "project_agent_owner_conflict" as const;

  constructor() {
    super("A production ProjectAgentHost is already installed in this process");
    this.name = "ProjectAgentOwnerConflictError";
  }
}

export type ProjectAgentProductionRepositoryRouter = ProjectAgentRepositoryRouter;

export type ProjectAgentProductionRuntime = Readonly<{
  attachProject: (binding: ProjectBinding) => unknown;
  repositoryRouter: ProjectAgentProductionRepositoryRouter;
  executionCoordinator: ProjectAgentExecutionCoordinator;
}>;

export type ProjectAgentProductionRuntimeDeps = Readonly<{
  createRepository: () => ProjectAgentProductionRepositoryRouter;
  subscribeSurface: () => () => void;
  registerIpc: (runtime: ProjectAgentProductionRuntime) => void;
}>;

let installed: ProjectAgentProductionRuntime | null = null;
let installing = false;

/**
 * Installs the app-process ProjectAgentHost exactly once. BrowserWindow
 * lifetime is intentionally absent: windows attach to this owner instead of
 * creating another host or another IPC writer.
 */
export function installProductionProjectAgentHost(
  deps: ProjectAgentProductionRuntimeDeps,
): ProjectAgentProductionRuntime {
  if (installed || installing) throw new ProjectAgentOwnerConflictError();
  installing = true;
  let unsubscribeSurface: (() => void) | undefined;
  try {
    const repositoryRouter = deps.createRepository();
    unsubscribeSurface = deps.subscribeSurface();
    const executionCoordinator = createProjectAgentExecutionCoordinator(repositoryRouter);
    const runtime: ProjectAgentProductionRuntime = Object.freeze({
      repositoryRouter,
      executionCoordinator,
      attachProject(binding: ProjectBinding): unknown {
        assertProjectAgentBinding(binding);
        return repositoryRouter.attach(binding);
      },
    });
    deps.registerIpc(runtime);
    installed = runtime;
    // Keep the subscription owned by the process. It is intentionally not
    // tied to BrowserWindow destruction/recreation.
    void unsubscribeSurface;
    return runtime;
  } catch (error) {
    try {
      unsubscribeSurface?.();
    } catch {
      // Preserve the registration failure; cleanup is best effort.
    }
    throw error;
  } finally {
    installing = false;
  }
}

export function getInstalledProductionProjectAgentHost(): ProjectAgentProductionRuntime | null {
  return installed;
}
