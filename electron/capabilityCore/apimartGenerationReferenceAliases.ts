import { bodyReferencedParamKeys } from "../catalog/paramTranslate";

/**
 * Preserve canonical reference aliases while keeping explicit first/last-frame
 * intent available to the shared headless projection.  Frame aliases are moved
 * to the intermediate *_frame_url keys so a mapping that also declares
 * image_urls cannot receive the same frame as a generic reference.
 */
export function mirrorApimartReferenceParameterAliases(
  parameters: Record<string, unknown>,
  createBody: unknown,
  sameJson: (left: unknown, right: unknown) => boolean,
): void {
  const keys = new Set(bodyReferencedParamKeys(createBody));
  const present = (value: unknown): boolean => value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0);
  const mirror = (target: string, source: string): void => {
    if (keys.has(target) && !present(parameters[target]) && present(parameters[source])) {
      parameters[target] = structuredClone(parameters[source]);
    }
  };
  mirror("input_urls", "image_urls");
  mirror("image_urls", "input_urls");
  mirror("first_frame_image", "first_frame_url");
  mirror("first_frame_url", "first_frame_image");
  mirror("last_frame_image", "last_frame_url");
  mirror("last_frame_url", "last_frame_image");
  for (const [wire, source] of [["first_frame_image", "first_frame_url"], ["last_frame_image", "last_frame_url"]] as const) {
    if (present(parameters[wire])) {
      if (present(parameters[source]) && !sameJson(parameters[wire], parameters[source])) {
        throw new Error("APIMart reference URL projection conflicts with canonical parameters");
      }
      parameters[source] = parameters[wire];
      delete parameters[wire];
    }
  }
}
