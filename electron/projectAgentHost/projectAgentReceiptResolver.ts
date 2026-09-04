import type { WorkspaceRepositoryDeps } from "../workspace/workspaceRepository";
import type { ProjectBinding } from "../shared/projectBinding";
import { getWorkspaceRepositoryDeps } from "../runtimePaths";
import { resolveWorkspaceProjectDir } from "../workspace/workspaceRepository";
import { assertProjectAgentBinding } from "./projectAgentIdentity";
import {
  createProjectAgentProposalReceiptService,
  type ProjectAgentProposalReceiptService,
} from "./projectAgentProposalReceiptStore";

export type DesktopProposalReceiptResolverDependencies = Readonly<{
  getWorkspaceRepositoryDeps: () => WorkspaceRepositoryDeps;
  resolveWorkspaceProjectDir: (projectId: string, deps: WorkspaceRepositoryDeps) => string | null;
  createProjectAgentProposalReceiptService: (input: Readonly<{
    projectRoot: string;
    binding: ProjectBinding;
  }>) => ProjectAgentProposalReceiptService;
}>;

export type DesktopProposalReceiptResolver = (
  binding: ProjectBinding | null | undefined,
) => ProjectAgentProposalReceiptService | undefined;

const productionDependencies: DesktopProposalReceiptResolverDependencies = {
  getWorkspaceRepositoryDeps,
  resolveWorkspaceProjectDir,
  createProjectAgentProposalReceiptService,
};

export function createDesktopProposalReceiptResolver(
  dependencies: DesktopProposalReceiptResolverDependencies = productionDependencies,
): DesktopProposalReceiptResolver {
  return (binding) => {
    if (binding == null) return undefined;
    assertProjectAgentBinding(binding);

    const projectRoot = dependencies.resolveWorkspaceProjectDir(
      binding.projectId,
      dependencies.getWorkspaceRepositoryDeps(),
    );
    if (!projectRoot) return undefined;

    return dependencies.createProjectAgentProposalReceiptService({ projectRoot, binding });
  };
}
