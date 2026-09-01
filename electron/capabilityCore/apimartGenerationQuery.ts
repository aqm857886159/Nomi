import { APIMART_IMAGE_QUERY_OP } from "../catalog/apimartVendor";
import { APIMART_VIDEO_QUERY } from "../catalog/apimartVideos";

/** APIMart's curated image/video mappings share this query path. Keep the
 * path derived from the catalog recipe instead of duplicating `/v1/tasks`. */
export function apimartTaskQueryPath(): string {
  const path = APIMART_IMAGE_QUERY_OP.path;
  if (path !== APIMART_VIDEO_QUERY.path) throw new Error("APIMart image/video query paths diverged");
  const marker = "/{{providerMeta.task_id}}";
  if (!path.endsWith(marker)) throw new Error("APIMart catalog query path is invalid");
  return path.slice(0, -marker.length);
}
