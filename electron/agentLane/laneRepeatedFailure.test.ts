import { describe, expect, it } from 'vitest';
import { createLaneRepeatedFailureTracker, LANE_REPEATED_FAILURE_BLOCK, LANE_REPEATED_FAILURE_TERMINATE } from './laneRepeatedFailure.mjs';

const WALL = 'The current target could not accept this action (surface_port_stale).\nNext: read again.';

describe('lane repeated-failure tracker', () => {
  it('blocks after the same tool fails the same way three times and terminates at five', () => {
    const tracker = createLaneRepeatedFailureTracker();
    for (let index = 1; index < LANE_REPEATED_FAILURE_BLOCK; index += 1) {
      tracker.note('read_script', true, WALL);
      expect(tracker.block('read_script')).toBeNull();
    }
    tracker.note('read_script', true, WALL);
    const blocked = tracker.block('read_script');
    expect(blocked).toMatchObject({ terminate: false });
    expect(blocked?.reason).toMatch(/failed the same way 3 times in a row/);
    expect(blocked?.reason).toMatch(/after the user's next message/);
    expect(blocked?.reason).not.toMatch(/cannot be done/);
    for (let index = LANE_REPEATED_FAILURE_BLOCK; index < LANE_REPEATED_FAILURE_TERMINATE; index += 1) tracker.note('read_script', true, WALL);
    expect(tracker.block('read_script')).toMatchObject({ terminate: true });
    // 别的工具不受牵连。
    expect(tracker.block('write_script')).toBeNull();
  });

  it('counts only the first line, and any other outcome — success or a different wall — clears the streak', () => {
    const tracker = createLaneRepeatedFailureTracker();
    expect(tracker.note('read_script', true, 'wall A\nline 2')).toBe(1);
    expect(tracker.note('read_script', true, 'wall A\nsomething else')).toBe(2);
    expect(tracker.note('read_script', true, 'wall B')).toBe(1);
    expect(tracker.note('read_script', false, 'ok')).toBe(0);
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
});
