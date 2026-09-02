// P4 S5 — 画布落地相关的两条 Run 命令 reducer（从 productionRunReducer 拆出，守 800 行门岗 · R9）。
// plan.bind-shot-nodes：确认即落 / 打开项目补齐建好占位后，把 shotId→nodeId 写进对应镜（+ 已建 job 继承）。
// plan.detach-shot-nodes：用户把占位从画布删掉（整批 Cmd+Z / 手动删）→ 记 canvasDetached、清 nodeId（撤销事实优先）。
import type { ProductionCommandEffect } from "./productionRunReducer";
import type { ProductionRun, RunCommand } from "./productionRunTypes";

/**
 * 把「shotId → 画布占位节点 id」写进对应镜。幂等：同 shotId 重复绑同一 nodeId 无实质改动（跑两次补齐不重复）。
 * 绑定即视为「重新出现」——清 canvasDetached（删过又补建 = 新节点）。已建 job（同 shotId）继承 nodeId，供 reconcile/回填。
 */
export function bindShotNodes(current: ProductionRun, command: RunCommand, now: string): ProductionCommandEffect {
  const eventType = "plan.shot-nodes.bound";
  const currentPlan = current.generationPlan;
  if (!currentPlan) return { run: current, eventType, message: current.runId };
  const rawBindings = Array.isArray(command.payload.bindings) ? command.payload.bindings : [];
  const bindByShot = new Map<string, string>();
  for (const raw of rawBindings) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    const shotId = typeof entry.shotId === "string" ? entry.shotId.trim() : "";
    const nodeId = typeof entry.nodeId === "string" ? entry.nodeId.trim() : "";
    if (shotId && nodeId) bindByShot.set(shotId, nodeId);
  }
  if (bindByShot.size === 0) return { run: current, eventType, message: current.runId };

  // Single-shot semantic plans intentionally keep the historical top-level
  // candidate shape (no `shots[]`).  They still need the same durable binding
  // so a provider result can be attached to the placeholder and a later
  // reconciliation pass cannot lose the node identity.  Use the candidate id
  // as the stable shot address, exactly as the landing projection does.
  if (!currentPlan.shots || currentPlan.shots.length === 0) {
    const shotId = currentPlan.candidate.candidateId;
    const nodeId = bindByShot.get(shotId);
    if (!nodeId) return { run: current, eventType, message: current.runId };
    const samePlanBinding = currentPlan.nodeId === nodeId && !currentPlan.canvasDetached;
    let changed = !samePlanBinding;
    const nextPlan = samePlanBinding
      ? currentPlan
      : (() => {
          const next = { ...currentPlan, nodeId, updatedAt: now };
          delete (next as { canvasDetached?: boolean }).canvasDetached;
          return next;
        })();
    const jobs = current.jobs.map((job) => {
      // A single plan has one generation lineage (including explicit rework
      // attempts); every attempt points at the same canvas result node.
      if (job.stageId !== "generate" || job.nodeId === nodeId) return job;
      changed = true;
      return { ...job, nodeId, updatedAt: now };
    });
    if (!changed) return { run: current, eventType, message: current.runId };
    return {
      run: { ...current, generationPlan: nextPlan, jobs, updatedAt: now },
      eventType,
      message: current.runId,
    };
  }

  let changed = false;
  const shots = currentPlan.shots.map((shot) => {
    const nodeId = bindByShot.get(shot.shotId);
    if (!nodeId || (shot.nodeId === nodeId && !shot.canvasDetached)) return shot;
    changed = true;
    const next = { ...shot, nodeId, updatedAt: now };
    delete (next as { canvasDetached?: boolean }).canvasDetached;
    return next;
  });
  const jobs = current.jobs.map((job) => {
    const shotId = typeof job.metadata?.shotId === "string" ? job.metadata.shotId : undefined;
    const nodeId = shotId ? bindByShot.get(shotId) : undefined;
    if (!nodeId || job.nodeId === nodeId) return job;
    changed = true;
    return { ...job, nodeId, updatedAt: now };
  });
  if (!changed) return { run: current, eventType, message: current.runId };
  return {
    run: { ...current, generationPlan: { ...currentPlan, shots, updatedAt: now }, jobs, updatedAt: now },
    eventType,
    message: current.runId,
  };
}

/**
 * 用户把这些占位节点从画布删掉了。忠实记账（撤销≠急停）：标 canvasDetached + 清 shot/job 的 nodeId →
 * 恢复补齐不复活（§3.4 以撤销事实为准）。在飞/已完成的 job 不动其生成状态：产物照进素材库+Run，只是占位没了。
 */
export function detachShotNodes(current: ProductionRun, command: RunCommand, now: string): ProductionCommandEffect {
  const eventType = "plan.shot-nodes.detached";
  const currentPlan = current.generationPlan;
  const rawNodeIds = Array.isArray(command.payload.nodeIds) ? command.payload.nodeIds : [];
  const detached = new Set(rawNodeIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim()));
  if (detached.size === 0) return { run: current, eventType, message: current.runId };
  let changed = false;
  if (currentPlan && (!currentPlan.shots || currentPlan.shots.length === 0)
    && currentPlan.nodeId && detached.has(currentPlan.nodeId)) {
    changed = true;
    const nextPlan = { ...currentPlan, canvasDetached: true, updatedAt: now };
    delete (nextPlan as { nodeId?: string }).nodeId;
    const jobs = current.jobs.map((job) => {
      if (job.stageId !== "generate" || !job.nodeId) return job;
      const next = { ...job, updatedAt: now };
      delete (next as { nodeId?: string }).nodeId;
      return next;
    });
    return {
      run: { ...current, generationPlan: nextPlan, jobs, updatedAt: now },
      eventType,
      message: current.runId,
    };
  }
  const shots = currentPlan?.shots?.map((shot) => {
    if (!shot.nodeId || !detached.has(shot.nodeId)) return shot;
    changed = true;
    const next = { ...shot, canvasDetached: true, updatedAt: now };
    delete (next as { nodeId?: string }).nodeId;
    return next;
  });
  const jobs = current.jobs.map((job) => {
    if (!job.nodeId || !detached.has(job.nodeId)) return job;
    changed = true;
    const next = { ...job, updatedAt: now };
    delete (next as { nodeId?: string }).nodeId;
    return next;
  });
  if (!changed) return { run: current, eventType, message: current.runId };
  return {
    run: {
      ...current,
      ...(currentPlan && shots ? { generationPlan: { ...currentPlan, shots, updatedAt: now } } : {}),
      jobs,
      updatedAt: now,
    },
    eventType,
    message: current.runId,
  };
}
