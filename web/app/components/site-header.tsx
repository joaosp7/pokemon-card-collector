import Link from "next/link";
import { AddCollectionDialog } from "@/app/components/add-collection-dialog";

export function SiteHeader() {
  return (
    <header className="border-b border-sleeve/25">
      <div className="mx-auto flex max-w-[90rem] items-center justify-between px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="font-display text-xl tracking-tight text-ink-navy"
        >
          Binder
        </Link>
        <AddCollectionDialog />
      </div>
    </header>
  );
}
