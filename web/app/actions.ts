"use server";

import { revalidatePath } from "next/cache";
import { isValidSlug } from "@/lib/catalog";
import { findSetBySlug, setCardExists } from "@/lib/catalog-db";
import { addCopy, removeCopy } from "@/lib/ownership-db";
import { ownershipActionContext } from "@/lib/ownership-action-context";

function cardExists(slug: string, setId: number, setCardId: string): boolean {
  const catalog = ownershipActionContext()?.catalog;
  if (!isValidSlug(slug)) {
    return false;
  }
  const set = findSetBySlug(slug, catalog);
  if (!set || set.id !== setId) {
    return false;
  }
  return setCardExists(setId, setCardId, catalog);
}

function revalidateCollection(slug: string): void {
  const revalidate = ownershipActionContext()?.revalidate ?? revalidatePath;
  revalidate("/");
  revalidate(`/collections/${slug}`);
}

export async function addCopyAction(
  slug: string,
  setId: number,
  setCardId: string,
): Promise<void> {
  if (!cardExists(slug, setId, setCardId)) {
    return;
  }
  addCopy(setId, setCardId, ownershipActionContext()?.ownership);
  revalidateCollection(slug);
}

export async function removeCopyAction(
  slug: string,
  setId: number,
  setCardId: string,
): Promise<void> {
  if (!cardExists(slug, setId, setCardId)) {
    return;
  }
  removeCopy(setId, setCardId, ownershipActionContext()?.ownership);
  revalidateCollection(slug);
}
