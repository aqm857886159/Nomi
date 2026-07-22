# ComfyUI Krea2 prompt source parsing

## Scope

- Fix custom ComfyUI workflow analysis so linked positive prompt inputs can resolve to an upstream editable text widget.
- Cover Krea2-style chains where `CLIPTextEncode.text` is connected through switch/preview/string nodes.
- Support ComfyUI first/last-frame video imports by binding the second image input to `{{request.params.last_frame_url}}`.
- Keep import UI, ComfyUI runtime submission, and existing direct `CLIPTextEncode.text` workflows unchanged.

## Non-goals

- Do not add model-specific Krea2 UI.
- Do not execute real ComfyUI generation in this slice.
- Do not change output detection or image/video upload behavior.

## Acceptance

- Existing SD and WAN workflow import tests still pass.
- A Krea2-style workflow suggests `PrimitiveStringMultiline.value` as the prompt binding.
- Building the imported workflow injects `{{request.prompt}}` into that upstream text widget.
- A Wan first/last frame workflow suggests start/end `LoadImage.image` bindings and builds an `image_to_video` mapping.
