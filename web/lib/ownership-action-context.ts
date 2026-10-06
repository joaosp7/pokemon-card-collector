import type Database from "better-sqlite3";

export type OwnershipActionContext = {
  catalog?: Database.Database;
  ownership?: Database.Database;
  revalidate?: (path: string) => void;
};

let context: OwnershipActionContext | undefined;

export function ownershipActionContext(): OwnershipActionContext | undefined {
  return context;
}

export function setOwnershipActionContextForTests(
  next: OwnershipActionContext | undefined,
): void {
  context = next;
}
