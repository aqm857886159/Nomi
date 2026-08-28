import { describe, expect, it, vi } from "vitest";

import {
  installProductionProjectAgentHost,
  type ProjectAgentProductionRepositoryRouter,
} from "./projectAgentProductionRuntime";

describe("production ProjectAgentHost ownership", () => {
  it("releases a surface subscription when IPC registration fails", () => {
    const unsubscribeSurface = vi.fn();
    const registerIpc = vi.fn(() => {
      throw new Error("register failed");
    });
    const createRepository = vi.fn(
      () =>
        ({
          attach: vi.fn(),
          repositoryFor: vi.fn(),
          partitionCount: vi.fn(),
        }) as unknown as ProjectAgentProductionRepositoryRouter,
    );

    expect(() =>
      installProductionProjectAgentHost({
        registerIpc,
        createRepository,
        subscribeSurface: () => unsubscribeSurface,
      }),
    ).toThrow("register failed");
    expect(unsubscribeSurface).toHaveBeenCalledTimes(1);
  });

  it("rejects a second owner before registering any side effects", () => {
    const registerIpc = vi.fn();
    const createRepository = vi.fn(
      () =>
        ({
          attach: vi.fn(),
          repositoryFor: vi.fn(),
          partitionCount: vi.fn(),
        }) as unknown as ProjectAgentProductionRepositoryRouter,
    );
    const subscribeSurface = vi.fn(() => vi.fn());
    const deps = { registerIpc, createRepository, subscribeSurface };

    const runtime = installProductionProjectAgentHost(deps);
    expect(runtime).toBeDefined();
    expect(registerIpc).toHaveBeenCalledTimes(1);
    expect(createRepository).toHaveBeenCalledTimes(1);
    expect(subscribeSurface).toHaveBeenCalledTimes(1);

    expect(() => installProductionProjectAgentHost(deps)).toThrowError(
      expect.objectContaining({ code: "project_agent_owner_conflict" }),
    );
    expect(registerIpc).toHaveBeenCalledTimes(1);
    expect(createRepository).toHaveBeenCalledTimes(1);
    expect(subscribeSurface).toHaveBeenCalledTimes(1);

    runtime.attachProject({
      projectId: "project-a",
      immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
      projectGeneration: 1,
    });
    runtime.attachProject({
      projectId: "project-b",
      immutableProjectUuid: "22222222-2222-4222-8222-222222222222",
      projectGeneration: 1,
    });
    expect(createRepository).toHaveBeenCalledTimes(1);
  });
});
