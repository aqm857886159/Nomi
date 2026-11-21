/**
 * "Is a key stored for this vendor" is a fact about the stored credential. The replace-key form is only a
 * view mode, so it must never feed this answer (a rejected replacement keeps the old key).
 */
export function resolveCredentialStored({
  credentialMaterialSaved,
  hasApiKey,
  savedHere,
}: {
  credentialMaterialSaved: boolean
  hasApiKey: boolean
  savedHere: boolean
}): boolean {
  return credentialMaterialSaved || hasApiKey || savedHere
}
