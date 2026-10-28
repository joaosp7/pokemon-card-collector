"use server";

import { revalidatePath } from "next/cache";
import { isValidSlug } from "@/lib/catalog";
import { deleteSetBySlug, findSetBySlug, setCardExists } from "@/lib/catalog-db";
import { isDownloadLocked } from "@/lib/download-collection";
import {
  discardParkedSetDirectory,
  parkSetImageDirectory,
  restoreParkedSetDirectory,
  type ParkedSetDirectory,
} from "@/lib/delete-set-files";
import { repoRoot } from "@/lib/data-paths";
import {
  addCopy,
  deleteOwnedForSet,
  listOwnedForSet,
  removeCopy,
  restoreOwnedForSet,
  type OwnedRow,
} from "@/lib/ownership-db";
import { ownershipActionContext } from "@/lib/ownership-action-context";

const SET_GONE = "This set is gone.";
const DOWNLOAD_RUNNING = "A download is already running.";
const IMAGE_FOLDER = "Could not delete the image folder.";
const SET_DELETE = "Could not delete this set.";

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

  if (isDownloadLocked()) {
    return { ok: false, error: DOWNLOAD_RUNNING };
  }

  let parked: ({ status: "parked" } & ParkedSetDirectory) | { status: "missing" };
  try {
    const moved = parkSetImageDirectory(root, slug);
    if (moved.status === "refused") {
      return { ok: false, error: IMAGE_FOLDER };
    }
    parked = moved;
  } catch {
    return { ok: false, error: IMAGE_FOLDER };
  }

  const owned = listOwnedForSet(set.id, ownership);
  try {
    deleteOwnedForSet(set.id, ownership);
    const removed = deleteSetBySlug(slug, catalog);
    if (!removed) {
      undoSetDelete(set.id, owned, ownership, parked);
      return { ok: false, error: SET_GONE };
    }
  } catch {
    undoSetDelete(set.id, owned, ownership, parked);
    return { ok: false, error: SET_DELETE };
  }

  if (parked.status === "parked") {
    try {
      discardParkedSetDirectory(parked);
    } catch {
      // The catalog row is already gone. A leftover parked folder is not the set.
    }
  }

  revalidateCollection(slug);
  return { ok: true };
}

function undoSetDelete(
  setId: number,
  owned: readonly OwnedRow[],
  ownership: Parameters<typeof restoreOwnedForSet>[2],
  parked: ({ status: "parked" } & ParkedSetDirectory) | { status: "missing" },
): void {
  try {
    restoreOwnedForSet(setId, owned, ownership);
  } catch {
    // Still put the image folder back when the ownership restore fails.
  }
  if (parked.status === "parked") {
    restoreParkedSetDirectory(parked);
  }
}
