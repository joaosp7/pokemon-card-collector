export const EXAMPLE_COLLECTION_URL =
  "https://www.ligapokemon.com.br/?view=cards/search&card=edid=806%20ed=M6";

export const COLLECTION_URL_ERROR =
  "Use a Liga Pokémon collection search URL (view=cards/search with edid=).";

const ALLOWED_HOSTS = new Set([
  "www.ligapokemon.com.br",
  "ligapokemon.com.br",
]);

/** Returns an error message, or null if the URL is a Liga collection search. */
export function collectionUrlError(url: unknown): string | null {
  if (typeof url !== "string" || url.trim() === "") {
    return COLLECTION_URL_ERROR;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return COLLECTION_URL_ERROR;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return COLLECTION_URL_ERROR;
  }

  if (!ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) {
    return COLLECTION_URL_ERROR;
  }

  if (parsed.searchParams.get("view") !== "cards/search") {
    return COLLECTION_URL_ERROR;
  }

  const card = parsed.searchParams.get("card");
  if (card === null || !card.includes("edid=")) {
    return COLLECTION_URL_ERROR;
  }

  return null;
}
