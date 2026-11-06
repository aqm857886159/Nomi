import { describe, expect, it } from 'vitest';
import { createLaneRepeatedFailureTracker, LANE_REPEATED_FAILURE_BLOCK } from './laneRepeatedFailure.mjs';

const WALL = 'The current target could not accept this action (surface_port_stale).\nNext: read again.';

describe('lane repeated-failure tracker', () => {
  it('blocks after the same tool fails the same way three times', () => {
    const tracker = createLaneRepeatedFailureTracker();
    for (let index = 1; index < LANE_REPEATED_FAILURE_BLOCK; index += 1) {
      tracker.note('read_script', true, WALL);
      expect(tracker.block('read_script')).toBeNull();
    }
    tracker.note('read_script', true, WALL);
    const blocked = tracker.block('read_script');
    expect(blocked?.reason).toMatch(/failed the same way 3 times in a row/);
    expect(blocked?.reason).toMatch(/after the user's next message/);
    expect(blocked?.reason).not.toMatch(/cannot be done/);
    // 别的工具不受牵连。
    expect(tracker.block('write_script')).toBeNull();
  });

  it('没有码时按首行认墙；每堵墙各记各的；这个工具成功一次就把它自己的墙全清掉', () => {
    const tracker = createLaneRepeatedFailureTracker();
    expect(tracker.note('read_script', true, 'wall A\nline 2')).toBe(1);
    expect(tracker.note('read_script', true, 'wall A\nsomething else')).toBe(2);
    // 换一堵墙 → 它从 1 开始；而 wall A 的 2 次**留着**（2026-09-22：旧版会把它抹掉）。
    expect(tracker.note('read_script', true, 'wall B')).toBe(1);
    expect(tracker.note('read_script', true, 'wall A\nagain')).toBe(3);
    expect(tracker.block('read_script')).not.toBeNull();
    expect(tracker.note('read_script', false, 'ok')).toBe(0);
    expect(tracker.block('read_script')).toBeNull();
  });

  // ── 2026-09-22 · 三条都来自 docs/evidence/2026-09-21-askback-real-model 的真实轨迹 ──
  //
  // 拿那 121 次调用重放旧计数器：整轮只有一次摸到 3，而 draft_shots 在 A3 那一轮连错 7 次。
  // 下面三条各钉住一个洞；每一条的注释里写清它是哪一段轨迹。

  it('A6：同一堵墙的正文首行变了（id / 镜头数 / 字段值），计数不该归零', () => {
    const tracker = createLaneRepeatedFailureTracker();
    const wall = { code: 'generation_input_invalid', issues: [{ path: 'shots.0.prompt' }] };
    expect(tracker.note('draft_shots', true, 'shots.0.prompt: Required (op-aaa)', wall)).toBe(1);
    expect(tracker.note('draft_shots', true, 'shots.0.prompt: Required (op-bbb)', wall)).toBe(2);
    expect(tracker.note('draft_shots', true, 'shots.0.prompt: Required (op-ccc)', wall)).toBe(3);
    expect(tracker.block('draft_shots'), '三次同码同字段还不拦 = 熔断在真机上形同不存在').not.toBeNull();
  });

  it('A3：换个工具不该把上一堵墙的计数冲掉（那 27 次就是在三个工具之间来回）', () => {
    const tracker = createLaneRepeatedFailureTracker();
    const wall = { code: 'generation_input_invalid' };
    tracker.note('draft_shots', true, 'x', wall);
    tracker.note('generate', true, 'y', { code: 'generation_approval_unavailable' });
    tracker.note('draft_shots', true, 'x', wall);
    tracker.note('check_job', true, 'z', { code: 'generation_operation_not_found' });
    expect(tracker.note('draft_shots', true, 'x', wall)).toBe(3);
    expect(tracker.block('draft_shots')).not.toBeNull();
  });

  it('A3 seq 30：一次无关的读成功，不证明那堵墙倒了', () => {
    const tracker = createLaneRepeatedFailureTracker();
    const wall = { code: 'generation_input_invalid' };
    tracker.note('draft_shots', true, 'x', wall);
    tracker.note('draft_shots', true, 'x', wall);
    tracker.note('list_models', false, '{"models":[…]}');
    expect(tracker.note('draft_shots', true, 'x', wall),
      'list_models 成功把 draft_shots 的连撞抹平了——真机上它正是这么逃掉熔断的').toBe(3);
    expect(tracker.block('draft_shots')).not.toBeNull();
    // 阳性对照：draft_shots **自己**成功了，它自己的墙才倒。
    tracker.note('draft_shots', false, 'ok');
    expect(tracker.block('draft_shots')).toBeNull();
  });

  // 2026-09-17：用户照着 Agent 的建议去点开文稿页也救不回来——熔断只认工具结果。现在用户再说一句话就解除。
  it('a new user message resets the streak so the tool can be tried again', () => {
    const tracker = createLaneRepeatedFailureTracker();
    for (let index = 0; index < LANE_REPEATED_FAILURE_BLOCK; index += 1) tracker.note('read_script', true, WALL);
    expect(tracker.block('read_script')).not.toBeNull();
    tracker.reset();
    expect(tracker.block('read_script')).toBeNull();
    // 阳性对照：解除后再撞三次，照样拦。
    for (let index = 0; index < LANE_REPEATED_FAILURE_BLOCK; index += 1) tracker.note('read_script', true, WALL);
    expect(tracker.block('read_script')).not.toBeNull();
  });

  // ── 2026-09-21 撞满转提问 ──────────────────────────────────────────────
  //
  // 这一组守的是「三振之后别再让模型自己编一段散文」：此刻缺的是**一个用户答得上来的问题**，
  // 而拒收信里那几个合法值就是现成的选项。

  it('三振之后点名 ask_user，并把上次拒收给的合法值当成选项交出去', () => {
    const tracker = createLaneRepeatedFailureTracker();
    for (let index = 0; index < LANE_REPEATED_FAILURE_BLOCK; index += 1) {
      tracker.note('draft_shots', true, WALL, ['9:16', '16:9', '1:1']);
    }
    const blocked = tracker.block('draft_shots');
    expect(blocked?.reason).toMatch(/ask_user/);
    expect(blocked?.reason).toMatch(/9:16, 16:9, 1:1/);
  });

  it('没拿到合法值时也要点名 ask_user，只是不编造选项', () => {
    const tracker = createLaneRepeatedFailureTracker();
    for (let index = 0; index < LANE_REPEATED_FAILURE_BLOCK; index += 1) tracker.note('read_script', true, WALL);
    const blocked = tracker.block('read_script');
    expect(blocked?.reason).toMatch(/ask_user/);
    expect(blocked?.reason).toMatch(/two to four answers/);
  });

  it('exhausted() 只在真的撞满之后才说话——没撞满时那张卡不该盖「试了 N 次」', () => {
    const tracker = createLaneRepeatedFailureTracker();
    expect(tracker.exhausted()).toBeUndefined();
    tracker.note('draft_shots', true, WALL, ['9:16', '16:9']);
    tracker.note('draft_shots', true, WALL, ['9:16', '16:9']);
    expect(tracker.exhausted(), '才两次就盖上「试了 N 次」是替模型说了一句没发生的话').toBeUndefined();
    tracker.note('draft_shots', true, WALL, ['9:16', '16:9']);
    expect(tracker.exhausted()).toEqual({ attempts: 3, allowed: ['9:16', '16:9'] });
    // 用户又说了一句话 = 回合边界：这一条和 block() 用的是同一个归零点，不许各归各的。
    tracker.reset();
    expect(tracker.exhausted()).toBeUndefined();
  });
});
