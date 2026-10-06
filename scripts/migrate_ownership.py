"""Copy legacy ownership rows into ownership.db.

Reads ``web/data/collection.db`` (``collection_slug``, ``collector_number``,
``copies``), resolves each row through ``data/catalog.db``, and upserts
``data/ownership.db``. Does not fetch Liga Pokémon, and does not modify the
source or catalog databases.

Safe to rerun: target rows are replaced, never incremented.
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import catalog_db
import ownership_db


class MigrationError(Exception):
    """The source or catalog database could not be read."""


@dataclass(frozen=True)
class PlannedOwnership:
    collection_slug: str
    collector_number: str
    set_id: int
    set_card_id: str
    copies: int
    updated_at: str


@dataclass(frozen=True)
class UnresolvedOwnership:
    collection_slug: object
    collector_number: object
    copies: object
    reason: str


@dataclass(frozen=True)
class MigrationReport:
    planned: tuple[PlannedOwnership, ...]
    unresolved: tuple[UnresolvedOwnership, ...]
    written: int
    dry_run: bool


def default_paths() -> tuple[Path, Path, Path]:
    """Return ``(source, target, catalog)`` for a normal run."""
    root = catalog_db.project_root()
    return (
        root / "web" / "data" / "collection.db",
        ownership_db.ownership_db_path(),
        catalog_db.catalog_db_path(),
    )


def migrate(
    *,
    source: Path | str,
    target: Path | str,
    catalog: Path | str,
    dry_run: bool = False,
    migrated_at: str | None = None,
) -> MigrationReport:
    """Resolve legacy rows and upsert them. Unresolved rows are reported."""
    timestamp = _migration_timestamp(migrated_at)
    source_conn = _open_readonly(Path(source), "source")
    try:
        catalog_conn = _open_readonly(Path(catalog), "catalog")
        try:
            planned, unresolved = _plan(source_conn, catalog_conn, timestamp)
        finally:
            catalog_conn.close()
    finally:
        source_conn.close()

    written = 0
    if not dry_run:
        written = _write_ownership(Path(target), planned)
    return MigrationReport(
        planned=planned,
        unresolved=unresolved,
        written=written,
        dry_run=dry_run,
    )


def format_report(report: MigrationReport) -> str:
    """Human-readable plan, including every unresolved source row."""
    if report.dry_run:
        lines = [
            f"Dry run: {len(report.planned)} planned row(s); wrote nothing"
        ]
    else:
        lines = [f"Migrated: {report.written} row(s)"]
    for row in report.planned:
        lines.append(
            f"  {row.collection_slug} {row.collector_number} -> "
            f"set_id={row.set_id} set_card_id={row.set_card_id} "
            f"copies={row.copies} updated_at={row.updated_at}"
        )
    lines.append(f"Unresolved: {len(report.unresolved)}")
    for row in report.unresolved:
        lines.append(
            f"  {row.reason}: collection_slug={row.collection_slug!r} "
            f"collector_number={row.collector_number!r} copies={row.copies}"
        )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    source, target, catalog = default_paths()
    if args.source is not None:
        source = args.source
    if args.target is not None:
        target = args.target
    if args.catalog is not None:
        catalog = args.catalog
    try:
        report = migrate(
            source=source,
            target=target,
            catalog=catalog,
            dry_run=args.dry_run,
        )
    except MigrationError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(format_report(report))
    return 0


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Copy legacy ownership rows into ownership.db using catalog.db. "
            "Does not fetch Liga Pokémon or modify the source or catalog databases."
        )
    )
    parser.add_argument(
        "--source",
        type=Path,
        help="Legacy ownership database (default: web/data/collection.db)",
    )
    parser.add_argument(
        "--target",
        type=Path,
        help="New ownership database (default: data/ownership.db)",
    )
    parser.add_argument(
        "--catalog",
        type=Path,
        help="Populated catalog database (default: data/catalog.db)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report planned rows and write nothing",
    )
    return parser.parse_args(argv)


def _migration_timestamp(migrated_at: str | None) -> str:
    if migrated_at is None:
        return datetime.now(timezone.utc).isoformat(timespec="seconds")
    text = migrated_at.strip()
    if not text:
        raise MigrationError("migrated_at must be non-empty ISO text")
    datetime.fromisoformat(text)
    return text


def _open_readonly(path: Path, label: str) -> sqlite3.Connection:
    if not path.is_file():
        raise MigrationError(f"{label} database not found: {path}")
    uri = f"{path.resolve().as_uri()}?mode=ro&immutable=1"
    try:
        return sqlite3.connect(uri, uri=True)
    except sqlite3.Error as exc:
        raise MigrationError(f"could not read {label} database {path}: {exc}") from exc


def _plan(
    source_conn: sqlite3.Connection,
    catalog_conn: sqlite3.Connection,
    migrated_at: str,
) -> tuple[tuple[PlannedOwnership, ...], tuple[UnresolvedOwnership, ...]]:
    sets, cards = _catalog_index(catalog_conn)
    planned: list[PlannedOwnership] = []
    unresolved: list[UnresolvedOwnership] = []
    for row in _source_rows(source_conn):
        outcome = _resolve_row(row, sets, cards, migrated_at)
        if isinstance(outcome, PlannedOwnership):
            planned.append(outcome)
        else:
            unresolved.append(outcome)
    return tuple(planned), tuple(unresolved)


def _source_rows(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    columns = [info[1] for info in conn.execute("PRAGMA table_info(owned_cards)")]
    if not columns:
        raise MigrationError("source database has no owned_cards table")
    missing = {"collection_slug", "collector_number", "copies"} - set(columns)
    if missing:
        names = ", ".join(sorted(missing))
        raise MigrationError(f"source owned_cards is missing columns: {names}")
    selected = ["collection_slug", "collector_number", "copies"]
    if "updated_at" in columns:
        selected.append("updated_at")
    conn.row_factory = sqlite3.Row
    return list(
        conn.execute(
            f"SELECT {', '.join(selected)} FROM owned_cards "
            "ORDER BY collection_slug, collector_number"
        )
    )


def _catalog_index(
    conn: sqlite3.Connection,
) -> tuple[dict[str, int], dict[int, set[str]]]:
    tables = {
        name
        for (name,) in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )
    }
    if "sets" not in tables or "set_cards" not in tables:
        raise MigrationError("catalog database is missing sets or set_cards")
    sets = {
        slug: int(set_id)
        for slug, set_id in conn.execute("SELECT slug, id FROM sets")
    }
    cards: dict[int, set[str]] = {}
    for set_id, card_id in conn.execute("SELECT set_id, id FROM set_cards"):
        cards.setdefault(int(set_id), set()).add(card_id)
    return sets, cards


def _resolve_row(
    row: sqlite3.Row,
    sets: Mapping[str, int],
    cards: Mapping[int, set[str]],
    migrated_at: str,
) -> PlannedOwnership | UnresolvedOwnership:
    slug = row["collection_slug"]
    number = row["collector_number"]
    copies = row["copies"]
    if not isinstance(slug, str) or slug == "":
        return UnresolvedOwnership(slug, number, copies, "invalid collection slug")
    if not isinstance(number, str) or number == "":
        return UnresolvedOwnership(slug, number, copies, "invalid collector number")
    set_id = sets.get(slug)
    if set_id is None:
        return UnresolvedOwnership(slug, number, copies, "unknown set")
    if number not in cards.get(set_id, ()):
        return UnresolvedOwnership(slug, number, copies, "unknown card")
    if isinstance(copies, bool) or not isinstance(copies, int) or copies < 1:
        return UnresolvedOwnership(slug, number, copies, "invalid copies")
    return PlannedOwnership(
        collection_slug=slug,
        collector_number=number,
        set_id=set_id,
        set_card_id=number,
        copies=copies,
        updated_at=_row_timestamp(row, migrated_at),
    )


def _row_timestamp(row: sqlite3.Row, migrated_at: str) -> str:
    if "updated_at" not in row.keys():
        return migrated_at
    historical = row["updated_at"]
    if isinstance(historical, str) and historical.strip():
        return historical
    return migrated_at


def _write_ownership(target: Path, planned: Sequence[PlannedOwnership]) -> int:
    conn = ownership_db.connect(target)
    try:
        with conn:
            for row in planned:
                conn.execute(
                    """
                    INSERT INTO owned_cards (set_id, set_card_id, copies, updated_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(set_id, set_card_id) DO UPDATE SET
                        copies = excluded.copies,
                        updated_at = excluded.updated_at
                    """,
                    (row.set_id, row.set_card_id, row.copies, row.updated_at),
                )
    finally:
        conn.close()
    return len(planned)


if __name__ == "__main__":
    raise SystemExit(main())
