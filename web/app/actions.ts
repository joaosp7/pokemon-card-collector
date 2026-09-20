"use server";

import { revalidatePath } from "next/cache";
import { isValidSlug, listCards } from "@/lib/catalog";
import { addCopy, removeCopy } from "@/lib/ownership";

function cardExists(slug: string, collectorNumber: string): boolean {
  if (!isValidSlug(slug)) {
    return false;
  }
  return listCards(slug).some((card) => card.collectorNumber === collectorNumber);
}

function revalidateCollection(slug: string): void {
  revalidatePath("/");
  revalidatePath(`/collections/${slug}`);
}

export async function addCopyAction(
  slug: string,
  collectorNumber: string,
): Promise<void> {
  if (!cardExists(slug, collectorNumber)) {
    return;
  }
  addCopy(slug, collectorNumber);
  revalidateCollection(slug);
}

export async function removeCopyAction(
  slug: string,
  collectorNumber: string,
): Promise<void> {
  if (!cardExists(slug, collectorNumber)) {
    return;
  }
  removeCopy(slug, collectorNumber);
  revalidateCollection(slug);
}
