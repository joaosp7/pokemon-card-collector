import Link from "next/link";
import type { CardFilter } from "@/lib/filter";

const TABS: { filter: CardFilter; label: string }[] = [
  { filter: "all", label: "All" },
  { filter: "missing", label: "Missing" },
  { filter: "owned", label: "Owned" },
];

export function FilterTabs({ active }: { active: CardFilter }) {
  return (
    <nav className="filter-rail" aria-label="Filter cards">
      {TABS.map((tab) => {
        const href = tab.filter === "all" ? "?filter=all" : `?filter=${tab.filter}`;
        const isActive = tab.filter === active;
        return (
          <Link
            key={tab.filter}
            href={href}
            className="filter-tab"
            aria-current={isActive ? "page" : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
