import type { ProjectBinding } from "../shared/projectBinding";
import { assertProjectAgentBinding, projectAgentPartitionKey } from "./projectAgentIdentity";
import { createOfflineProjectAgentHost, type OfflineProjectAgentHost } from "./projectAgentHost";
import { createProjectAgentRepository, type ProjectAgentRepository } from "./projectAgentRepository";

export type ProjectAgentRepositoryRouter = Readonly<{
  attach: (binding: ProjectBinding) => OfflineProjectAgentHost;
  repositoryFor: (binding: ProjectBinding) => ProjectAgentRepository;
  partitionCount: () => number;
}>;

export function createProjectAgentRepositoryRouter(input: Readonly<{ rootDir: string }>): ProjectAgentRepositoryRouter {
  const repositories = new Map<string, ProjectAgentRepository>();
  const hosts = new Map<string, OfflineProjectAgentHost>();

  function repositoryFor(binding: ProjectBinding): ProjectAgentRepository {
    assertProjectAgentBinding(binding);
    const key = projectAgentPartitionKey(binding);
    let repository = repositories.get(key);
    if (!repository) {
      repository = createProjectAgentRepository({ rootDir: input.rootDir });
      repositories.set(key, repository);
    }
    return repository;
  }

  function attach(binding: ProjectBinding): OfflineProjectAgentHost {
    assertProjectAgentBinding(binding);
    const key = projectAgentPartitionKey(binding);
    let host = hosts.get(key);
    if (!host) {
      host = createOfflineProjectAgentHost({ repository: repositoryFor(binding) });
      hosts.set(key, host);
    }
    host.getSnapshot(binding);
    return host;
  }

  return Object.freeze({ attach, repositoryFor, partitionCount: () => repositories.size });
}
