# Veo 3.1 node panel crash

> 状态：✅ 已交付

## Scope

- Fix the shared auto-selection/meta write boundary used by every generation-node parameter control.
- Add a zero-credit Electron regression walk covering APIMart, Dreamina, and Runway model transitions.
- Record the recurring root-cause contract and exact pre/post evidence.

## Not in scope

- No provider API changes, model catalog changes, generation requests, or UI copy changes.
- No changes to the separate Agent proposal flow; it does not mount this node auto-selection hook.

## Rollback

Revert the hook and walk changes plus this contract/plan; no persisted data migration or external state change is introduced.

## Acceptance

- The unmodified walk reproduces React error #185 and the node-panel error boundary.
- The same walk passes after the shared live-store write fix.
- `gates:contracts`, `test`, and `build` pass.
