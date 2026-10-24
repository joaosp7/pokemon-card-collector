"use server";

import { revalidatePath } from "next/cache";
import { isValidSlug } from "@/lib/catalog";
import { deleteSetBySlug, findSetBySlug, setCardExists } from "@/lib/catalog-db";
import { removeSetImageDirectory } from "@/lib/delete-set-files";
import { repoRoot } from "@/lib/data-paths";
import { addCopy, deleteOwnedForSet, removeCopy } from "@/lib/ownership-db";
import { ownershipActionContext } from "@/lib/ownership-action-context";

const SET_GONE = "This set is gone.";

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

export async function deleteSetAction(
  slug: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isValidSlug(slug)) {
    return { ok: false, error: SET_GONE };
  }

  const ctx = ownershipActionContext();
  const catalog = ctx?.catalog;
  const ownership = ctx?.ownership;
  const root = ctx?.root ?? repoRoot();
  const set = findSetBySlug(slug, catalog);
  if (!set) {
    return { ok: false, error: SET_GONE };
  }

  try {
    const images = removeSetImageDirectory(root, slug);
    if (images === "refused") {
      return { ok: false, error: "Could not delete the image folder." };
    }
  } catch {
    return { ok: false, error: "Could not delete the image folder." };
  }

  try {
    deleteOwnedForSet(set.id, ownership);
    const removed = deleteSetBySlug(slug, catalog);
    if (!removed) {
      return { ok: false, error: SET_GONE };
    }
  } catch {
    return { ok: false, error: "Could not delete this set." };
  }

  revalidateCollection(slug);
  return { ok: true };
}
