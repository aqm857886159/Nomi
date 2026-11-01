/** Official 2020-12 meta-schema compiled by scripts/gen-model-schema-meta-validator.mjs. */
declare const validate: ((schema: unknown) => boolean) & {
  errors: readonly { instancePath: string; message?: string }[] | null;
};
export = validate;
