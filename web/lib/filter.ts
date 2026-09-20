import type { Card } from "./catalog";

export type CardFilter = "all" | "missing" | "owned";

export function copiesOf(
  ownedMap: Map<string, number>,
  collectorNumber: string,
): number {
  return ownedMap.get(collectorNumber) ?? 0;
}

export function parseFilter(value: unknown): CardFilter {
  if (value === "missing" || value === "owned") {
    return value;
  }
  return "all";
}

export function filterCards(
  cards: Card[],
  ownedMap: Map<string, number>,
  filter: string,
): Card[] {
  if (filter === "missing") {
    return cards.filter((card) => copiesOf(ownedMap, card.collectorNumber) === 0);
  }
  if (filter === "owned") {
    return cards.filter((card) => copiesOf(ownedMap, card.collectorNumber) >= 1);
  }
  return cards;
}
