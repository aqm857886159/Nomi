export type SkillZipImportPayload = {
  kind: "zip";
  fileName: string;
  bytes: Uint8Array;
};
