export function formatProviderMetadata(metadata) {
  if (!metadata?.provider || !metadata?.model) return null;
  const provider = metadata.provider === "gemini" ? "Gemini" : metadata.provider === "groq" ? "Groq" : metadata.provider;
  return {
    label: `${provider}${metadata.fallback_used ? " fallback" : " primary"}`,
    model: metadata.model,
    fallbackUsed: Boolean(metadata.fallback_used),
  };
}
