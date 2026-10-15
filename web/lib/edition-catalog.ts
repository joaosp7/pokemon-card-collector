export type LigaEdition = {
  name: string | null;
  name_en: string | null;
  name_pt: string | null;
  name_pt_ascii: string | null;
  set_code: string;
  url: string;
};

const NAME_FIELDS = ["name", "name_en", "name_pt", "name_pt_ascii"] as const;

export function isLigaEdition(value: unknown): value is LigaEdition {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const row = value as Record<string, unknown>;
  if (
    !NAME_FIELDS.every(
      (field) => row[field] === null || typeof row[field] === "string",
    )
  ) {
    return false;
  }
  return (
    typeof row.set_code === "string" &&
    row.set_code !== "" &&
    typeof row.url === "string" &&
    row.url !== ""
  );
}

export function parseEditionList(value: unknown): LigaEdition[] | null {
  if (!Array.isArray(value) || !value.every(isLigaEdition)) {
    return null;
  }
  return value;
}

export function editionLabel(edition: LigaEdition): string {
  return edition.name ?? edition.name_en ?? edition.set_code;
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

function searchFields(edition: LigaEdition): string[] {
  return [edition.name, edition.name_en, edition.name_pt, edition.name_pt_ascii, edition.set_code].flatMap(
    (value) => (value ? [fold(value)] : []),
  );
}

export function filterEditions(
  editions: LigaEdition[],
  query: string,
): LigaEdition[] {
  const needle = fold(query.trim());
  if (!needle) {
    return editions;
  }
  return editions.filter((edition) =>
    searchFields(edition).some((field) => field.includes(needle)),
  );
}

/** Unique exact match on a name or set code, or null. */
export function matchEdition(
  editions: LigaEdition[],
  query: string,
): LigaEdition | null {
  const needle = fold(query.trim());
  if (!needle) {
    return null;
  }
  const matches = editions.filter((edition) =>
    searchFields(edition).some((field) => field === needle),
  );
  return matches.length === 1 ? matches[0] : null;
}
