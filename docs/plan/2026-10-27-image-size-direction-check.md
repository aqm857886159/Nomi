# Direction check: image-size policy at the shared parameter boundary

## 0. Class root

One persisted transform ID is used for both image and video operations, but its numeric policy has no operation context. Applying the GPT Image area floor globally changes video requests too.

## 1. Classification

| Evidence | Direct cause | Class |
| --- | --- | --- |
| Image 16:9 / 1K produces 1024x576 | Missing minimum area check | Incomplete image wire-size domain |
| Some 3:1 sizes exceed 3 after rounding | Quantization happens without a ratio bound | Same image domain |
| First image repair changes persisted video requests to 1088x608 | Image/video mappings persist the same transform ID | Missing task domain at the shared transform |
| Recent `profileHttpRequest.ts` fixes concern wire model names | A shared request context owns multiple wire concerns | Hotspot review trigger, not proof of the same numeric defect |

## 2. Structural reason and experience contract

JSON and multipart already converge at `templateContext`, which receives the actual `TaskRequest.kind`. Pass that kind to the existing transform registry. Do not infer media type from model names, vendor names, duration, or incidental fields. Keep persisted transform IDs and route mappings unchanged.

Experience laws: ⑩ the selected ratio stays within one 16-pixel step; ⑪ the matrix comes from the real GPT Image 2 selectable profile; ⑫ the final JSON/multipart request is the observation boundary. Live desktop clicks remain unverified, not replaced by the mock receipt.

## 3. Testable predictions

| Without the boundary | Characterization |
| --- | --- |
| Global image bounds also resize video | `providerOnboardingContract.test.ts`: saved text-to-video and image-to-video mappings |
| Fixing JSON alone leaves edits invalid | Same test exercises `executeProfileOperation` with both JSON and multipart |
| One example misses portrait/extreme ratios | `paramTranslate.test.ts`: all profile ratios × 1K/2K/4K |

## 4. Oracle independence

The old test asserted 1024x576 for image 1K, contrary to the official minimum of 655360 pixels. The replacement asserts the independently documented domain, not one implementation-specific output. Video expectations characterize unchanged baseline behavior. Before isolation, both video tests fail while the image request tests pass.

## 5. P0 / reuse

Reuse the existing canonical-to-wire mapping and task-kind discriminator. Provider numeric bounds are contract data; no general-purpose dependency can choose this application's canonical resolution tier or identify its persisted task mode. No new dependency, uploader, transport, or model-specific UI is needed.

## 6. Options and recommendation

| Option | Cost and risk | Decision |
| --- | --- | --- |
| Apply an external validator | Still needs task-kind ownership and size derivation | Does not replace the missing boundary |
| Apply image limits globally | Small patch, changes video behavior | Rejected by characterization |
| Rename transforms and migrate persisted mappings | Wider migration surface and ambiguity for custom operations | Unnecessary |
| Carry the existing task kind through the shared transform call | One context argument; preserves saved mappings and video sizing | Recommended implementation |
| Delete size derivation | Removes a supported ratio/resolution control | Reject |

## 7. Tradeoff and scope

Keep one transform entry point with an explicit media-domain input rather than expand the catalog migration surface. This is a compatibility-preserving implementation choice within the user's explicit request to fix the shared boundary and preserve migrations; it does not change product direction or authorize unrelated hotspot repairs.

Characterization evidence: pre-isolation Vitest run (2 video failures, 14 image passes); tests and their assertions are committed with the repair. `profileHttpRequest.ts` only forwards `request.kind`; ownership and enforcement remain in `paramTranslate.ts`.
