/** Stable error contract shared by the APIMart provider and its pure helpers. */
export class ApimartGenerationProviderError extends Error {
  readonly code = "apimart_provider_error" as const;

  constructor(message: string) {
    super(message);
    this.name = "ApimartGenerationProviderError";
  }
}
