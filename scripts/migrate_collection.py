"""Import an existing Liga collection into catalog.db without downloading images.

Local files under ``cards/`` stay where they are. The script records catalog
metadata and the front image path it finds (current filename, otherwise legacy).
It does not call the CDN downloader, does not fetch ``f_sP``, and does not
write or rename card files.
"""

from __future__ import annotations

import argparse
import shutil
import sqlite3
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import catalog_db
import catalog_fields
from download_collection import (
    collection_folder_name,
    fetch_page_data,
    legacy_card_filename,
    sanitize_collection_url,
    sort_cards,
)

LOGO_SUFFIXES = frozenset({".png", ".webp", ".jpg", ".jpeg"})
FetchCatalog = Callable[[str], tuple[str, list[dict[str, Any]], str]]


@dataclass
class MigrationReport:
    set_id: int
    set_code: str
    name_pt: str | None
    slug: str
    source_url: str
    card_count: int
    logo_path: str | None
    missing_images: list[str] = field(default_factory=list)


def set_title(title: str) -> str:
    """Page title before the site suffix, accents preserved."""
    return title.split("|", 1)[0].strip()


def resolve_front_image(
    card: dict[str, Any], slug: str, cards_dir: Path
) -> tuple[str, bool]:
    """Return ``(project-relative path, missing)``.

    Prefer the current filename when that file is already on disk. Otherwise
    keep a legacy filename in place. When neither file exists, return the
    expected current path and mark it missing. Never renames or creates files.
    """
    current_rel = catalog_fields.image_path(card, slug)
    set_dir = cards_dir / slug
    if (set_dir / Path(current_rel).name).is_file():
        return current_rel, False
    legacy_name = legacy_card_filename(card)
    if (set_dir / legacy_name).is_file():
        return f"cards/{slug}/{legacy_name}", False
    return current_rel, True


def copy_logo(logo: Path, slug: str, cards_dir: Path) -> str:
    """Copy ``logo`` into the set folder and return its project-relative path."""
    source = Path(logo)
    if not source.is_file():
        raise ValueError(f"logo file not found: {source}")
    suffix = source.suffix.lower()
    if suffix not in LOGO_SUFFIXES:
        raise ValueError("logo must be a png, webp, jpg, or jpeg file")
    destination = cards_dir / slug / f"logo{suffix}"
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)
    return f"cards/{slug}/logo{suffix}"


def migrate(
    url: str,
    *,
    logo: Path | str | None = None,
    db_path: Path | str | None = None,
    cards_dir: Path | None = None,
    fetch: FetchCatalog | None = None,
) -> MigrationReport:
    """Upsert one Liga catalog into catalog.db. Does not download images."""
    source_url = sanitize_collection_url(url)
    fetch_catalog = fetch if fetch is not None else fetch_page_data
    title, catalog, sigla = fetch_catalog(source_url)
    if not catalog:
        raise ValueError("No cards found in page catalog.")

    ordered = sort_cards(list(catalog))
    set_code = str(sigla or ordered[0].get("sSigla") or "").strip()
    if not set_code:
        raise ValueError("missing set code")
    slug = collection_folder_name(title, set_code)
    root_cards = (
        cards_dir
        if cards_dir is not None
        else catalog_db.project_root() / "cards"
    )

    rows: list[dict[str, str | None]] = []
    missing: list[str] = []
    for source in ordered:
        row = catalog_fields.normalize_card(source, slug=slug)
        image_path, absent = resolve_front_image(source, slug, root_cards)
        row["image_path"] = image_path
        rows.append(row)
        if absent:
            missing.append(image_path)

    fields: dict[str, Any] = {
        "set_code": set_code,
        "name_pt": set_title(title),
        "slug": slug,
        "source_url": source_url,
        "card_count": len(catalog),
    }
    if logo is not None:
        fields["logo_path"] = copy_logo(Path(logo), slug, root_cards)

    conn = catalog_db.connect(db_path)
    try:
        set_id = catalog_db.import_set(conn, fields, rows)
        stored = catalog_db.find_set_by_code(conn, set_code)
    finally:
        conn.close()
    if stored is None:
        raise sqlite3.DatabaseError(f"set {set_code} missing after import")

    return MigrationReport(
        set_id=set_id,
        set_code=str(stored["set_code"]),
        name_pt=stored["name_pt"],
        slug=str(stored["slug"]),
        source_url=str(stored["source_url"]),
        card_count=int(stored["card_count"]),
        logo_path=stored["logo_path"],
        missing_images=missing,
    )


def format_report(report: MigrationReport) -> str:
    lines = [
        f"Collection: {report.slug}",
        f"Set: {report.set_code}",
        f"Set id: {report.set_id}",
        f"Cards: {report.card_count}",
    ]
    if report.logo_path:
        lines.append(f"Logo: {report.logo_path}")
    lines.append(f"Missing images: {len(report.missing_images)}")
    lines.extend(f"missing {path}" for path in report.missing_images)
    return "\n".join(lines)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Import Liga Pokémon catalog metadata for an existing collection. "
            "Does not download card images."
        ),
    )
    parser.add_argument(
        "url",
        type=sanitize_collection_url,
        help="Liga Pokémon collection search URL",
    )
    parser.add_argument(
        "--logo",
        type=Path,
        help="Optional logo file copied into the set folder (png, webp, jpg, jpeg)",
    )
    return parser.parse_args(argv)


def main(
    argv: list[str] | None = None,
    *,
    db_path: Path | str | None = None,
    cards_dir: Path | None = None,
    fetch: FetchCatalog | None = None,
) -> int:
    args = parse_args(argv)
    try:
        report = migrate(
            args.url,
            logo=args.logo,
            db_path=db_path,
            cards_dir=cards_dir,
            fetch=fetch,
        )
    except (OSError, ValueError, sqlite3.Error) as exc:
        print(exc, file=sys.stderr)
        return 1
    print(format_report(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
