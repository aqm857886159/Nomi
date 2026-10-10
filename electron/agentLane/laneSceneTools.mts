// Agent lane · 场景工具的可见性（只管「模型看不看得到」，不碰执行 / 审批 / 权限）。
//
// 声明在 `VerbDeclaration.residentScene`；这里是宿主侧唯一的切换点。场景工具始终注册在 pi 里（所以被
// 允许时能执行），只是不在场景里就不进激活清单：schema 与提示词条目都不发。进出场景各让工具前缀变一次。
import type { AgentLane } from '@earendil-works/pi-agent-core';
import type { Context } from '@earendil-works/pi-agent-core/harness/context';
import type { LaneToolScene } from '../shared/agentCapabilities/verbDeclaration.js';
import { laneSceneToolNames } from './laneToolGroups.mjs';

type SceneTool = { readonly name: string; readonly residentScene?: LaneToolScene };

export function createLaneSceneTools(tools: readonly SceneTool[]) {
  const names = new Set(tools.filter(tool => tool.residentScene).map(tool => tool.name));
  let open: readonly LaneToolScene[] = [];
  return {
    /** 创建时的默认清单：已注册的工具里去掉场景工具（场景默认关）。 */
    initialActive: (registered: Iterable<string>) => [...registered].filter(name => !names.has(name)),
    /** 此刻没进清单的场景工具（提示词据此去掉它们的条目并交代原因）。 */
    hidden: () => tools.filter(tool => tool.residentScene && !open.includes(tool.residentScene)).map(tool => tool.name),
    /**
     * 让激活清单与此次准入时用户所在的场景一致；清单没变就不写。
     * 非场景工具的相对顺序不动，场景工具总是追加在末尾（前缀稳定）。
     */
    async sync(lane: Pick<AgentLane, 'getActiveTools' | 'setActiveTools'>, scenes: readonly LaneToolScene[], context: Context): Promise<void> {
      open = scenes;
      if (names.size === 0) return;
      const visible = new Set(laneSceneToolNames(tools, scenes));
      const current = await lane.getActiveTools(context);
      const next = [...current.filter(name => !names.has(name)), ...tools.filter(tool => visible.has(tool.name)).map(tool => tool.name)];
      if (next.length !== current.length || next.some((name, index) => name !== current[index])) await lane.setActiveTools(next, context);
    },
  };
}
