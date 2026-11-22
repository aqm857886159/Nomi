import { describe, expect, it } from 'vitest';
import { createLaneRepeatedFailureTracker, LANE_REPEATED_FAILURE_BLOCK } from './laneRepeatedFailure.mjs';

const WALL_FAILURE = { code: 'surface_port_stale' };

describe('lane repeated-failure tracker', () => {
  it('blocks after the same tool fails three times since it last succeeded, and says one more call ends the turn', () => {
    const tracker = createLaneRepeatedFailureTracker();
    for (let index = 1; index < LANE_REPEATED_FAILURE_BLOCK; index += 1) {
      tracker.note('read_script', true, WALL_FAILURE);
      expect(tracker.block('read_script')).toBeNull();
    }
    tracker.note('read_script', true, WALL_FAILURE);
    const blocked = tracker.block('read_script');
    expect(blocked?.reason).toMatch(/failed 3 times in a row since it last succeeded/);
    expect(blocked?.reason).toMatch(/one more call to it ends this turn/);
    expect(blocked?.reason).toMatch(/after the user's next message/);
    expect(blocked?.reason).not.toMatch(/cannot be done/);
    // 别的工具不受牵连。
    expect(tracker.block('write_script')).toBeNull();
  });

  // 2026-11-09：按码 / 字段分桶时，每次换一个错字段就另起一桶，10 次失败熔断一次不跳（免费复现：一回合 11 次请求）。
  it('换一个错字段、换一个失败码都不算进展：这个工具自上次成功以来的失败全算在一起；它自己成功一次才归零', () => {
    const tracker = createLaneRepeatedFailureTracker();
    expect(tracker.note('draft_shots', true, { code: 'tool_arguments_invalid', issues: [{ path: 'shots.0.bogus_a' }] })).toBe(1);
    expect(tracker.note('draft_shots', true, { code: 'tool_arguments_invalid', issues: [{ path: 'shots.0.bogus_b' }] })).toBe(2);
    expect(tracker.block('draft_shots')).toBeNull();
    expect(tracker.note('draft_shots', true, { code: 'generation_input_invalid', issues: [{ path: 'parameters.resolution' }] })).toBe(3);
    expect(tracker.block('draft_shots')).not.toBeNull();
    expect(tracker.note('draft_shots', false)).toBe(0);
    expect(tracker.block('draft_shots')).toBeNull();
  });

  // ── 2026-09-22 · 三条都来自 docs/evidence/2026-09-21-askback-real-model 的真实轨迹 ──
  //
  // 拿那 121 次调用重放旧计数器：整轮只有一次摸到 3，而 draft_shots 在 A3 那一轮连错 7 次。
  // 下面三条各钉住一个洞；每一条的注释里写清它是哪一段轨迹。

  it('A6：同一个错的正文每次长得不一样（id / 镜头数 / 字段值），计数不该归零——计数根本不看正文', () => {
    const tracker = createLaneRepeatedFailureTracker();
    const wall = { code: 'generation_input_invalid', issues: [{ path: 'shots.0.prompt' }] };
    expect(tracker.note('draft_shots', true, wall)).toBe(1);
    expect(tracker.note('draft_shots', true, wall)).toBe(2);
    expect(tracker.note('draft_shots', true, wall)).toBe(3);
    expect(tracker.block('draft_shots'), '三次连败还不拦 = 熔断在真机上形同不存在').not.toBeNull();
  });

  it('A3：换个工具不该把上一个工具的连败冲掉（那 27 次就是在三个工具之间来回）', () => {
    const tracker = createLaneRepeatedFailureTracker();
    const wall = { code: 'generation_input_invalid' };
    tracker.note('draft_shots', true, wall);
    tracker.note('generate', true, { code: 'generation_approval_unavailable' });
    tracker.note('draft_shots', true, wall);
    tracker.note('check_job', true, { code: 'generation_operation_not_found' });
    expect(tracker.note('draft_shots', true, wall)).toBe(3);
    expect(tracker.block('draft_shots')).not.toBeNull();
  });

  it('A3 seq 30：一次无关的读成功，不证明那条连败结束了', () => {
    const tracker = createLaneRepeatedFailureTracker();
    const wall = { code: 'generation_input_invalid' };
    tracker.note('draft_shots', true, wall);
    tracker.note('draft_shots', true, wall);
    tracker.note('list_models', false);
    expect(tracker.note('draft_shots', true, wall),
      'list_models 成功把 draft_shots 的连撞抹平了——真机上它正是这么逃掉熔断的').toBe(3);
    expect(tracker.block('draft_shots')).not.toBeNull();
    // 阳性对照：draft_shots **自己**成功了，它自己的连败才归零。
    tracker.note('draft_shots', false);
    expect(tracker.block('draft_shots')).toBeNull();
  });

  // 2026-09-17：用户照着 Agent 的建议去点开文稿页也救不回来——熔断只认工具结果。现在用户再说一句话就解除。
  it('a new user message resets the streak so the tool can be tried again', () => {
    const tracker = createLaneRepeatedFailureTracker();
    for (let index = 0; index < LANE_REPEATED_FAILURE_BLOCK; index += 1) tracker.note('read_script', true, WALL_FAILURE);
    expect(tracker.block('read_script')).not.toBeNull();
    tracker.reset();
    expect(tracker.block('read_script')).toBeNull();
    // 阳性对照：解除后再撞三次，照样拦。
    for (let index = 0; index < LANE_REPEATED_FAILURE_BLOCK; index += 1) tracker.note('read_script', true, WALL_FAILURE);
    expect(tracker.block('read_script')).not.toBeNull();
  });

  // ── 2026-09-21 撞满转提问 ──────────────────────────────────────────────
  //
  // 这一组守的是「三振之后别再让模型自己编一段散文」：此刻缺的是**一个用户答得上来的问题**，
  // 而拒收信里那几个合法值就是现成的选项。

  it('三振之后点名 ask_user，并把上次拒收给的合法值当成选项交出去', () => {
    const tracker = createLaneRepeatedFailureTracker();
    for (let index = 0; index < LANE_REPEATED_FAILURE_BLOCK; index += 1) {
      tracker.note('draft_shots', true, ['9:16', '16:9', '1:1']);
    }
    const blocked = tracker.block('draft_shots');
    expect(blocked?.reason).toMatch(/ask_user/);
    expect(blocked?.reason).toMatch(/9:16, 16:9, 1:1/);
  });

  it('没拿到合法值时也要点名 ask_user，只是不编造选项', () => {
    const tracker = createLaneRepeatedFailureTracker();
    for (let index = 0; index < LANE_REPEATED_FAILURE_BLOCK; index += 1) tracker.note('read_script', true, WALL_FAILURE);
    const blocked = tracker.block('read_script');
    expect(blocked?.reason).toMatch(/ask_user/);
    expect(blocked?.reason).toMatch(/two to four answers/);
  });

  it('exhausted() 只在真的撞满之后才说话——没撞满时那张卡不该盖「试了 N 次」', () => {
    const tracker = createLaneRepeatedFailureTracker();
    expect(tracker.exhausted()).toBeUndefined();
    tracker.note('draft_shots', true, ['9:16', '16:9']);
    tracker.note('draft_shots', true, ['9:16', '16:9']);
    expect(tracker.exhausted(), '才两次就盖上「试了 N 次」是替模型说了一句没发生的话').toBeUndefined();
    tracker.note('draft_shots', true, ['9:16', '16:9']);
    expect(tracker.exhausted()).toEqual({ attempts: 3, allowed: ['9:16', '16:9'] });
    // 用户又说了一句话 = 回合边界：这一条和 block() 用的是同一个归零点，不许各归各的。
    tracker.reset();
    expect(tracker.exhausted()).toBeUndefined();
  });
});
