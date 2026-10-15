"""Add Liga Pokémon editions that are missing from data/liga-editions.json."""

from __future__ import annotations

import html
import json
import sys
from pathlib import Path
from typing import Any
from urllib.parse import quote

EDITIONS_URL = "https://www.ligapokemon.com.br/?view=cards/edicoes"
SEARCH_URL = "https://www.ligapokemon.com.br/?view=cards/search&card="
PAYLOAD_WAIT_JS = """() => {
    return [...document.scripts].some((script) =>
        (script.textContent || "").includes("jsonEditions")
    );
}"""
EXTRACT_JS = """() => {
    const script = [...document.scripts]
        .map((node) => node.textContent || "")
        .find((text) => text.includes("jsonEditions"));
    if (!script) {
        return null;
    }
    const marker = "let jsonEditions = ";
    const start = script.indexOf(marker);
    if (start < 0) {
        return null;
    }
    const source = script.slice(start + marker.length);
    const end = source.indexOf(";\\n");
    const raw = end >= 0 ? source.slice(0, end) : source;
    const data = JSON.parse(raw);
    return { main: data.main || [], aux: data.aux || {} };
}"""


def project_root() -> Path:
    here = Path(__file__).resolve().parent
    if here.name == "scripts" and (here.parent / "pyproject.toml").is_file():
        return here.parent
    return here.parent


def editions_path() -> Path:
    return project_root() / "data" / "liga-editions.json"


def clean_name(value: Any) -> str | None:
    text = html.unescape(str(value or "")).strip()
    return text or None


def edition_record(raw: dict[str, Any]) -> dict[str, Any]:
    edid = str(raw.get("id") or "").strip()
    acronym = str(raw.get("acronym") or "").strip()
    if not edid or not acronym:
        raise ValueError("Liga edition is missing an id or acronym.")
    card = f"edid={quote(edid, safe='')}%20ed={quote(acronym, safe='-._')}"
    return {
        "name": clean_name(raw.get("name")),
        "name_en": clean_name(raw.get("nameen")),
        "name_pt": clean_name(raw.get("namept")),
        "name_pt_ascii": clean_name(raw.get("nameptsa")),
        "set_code": acronym,
        "url": SEARCH_URL + card,
    }


def editions_from_payload(payload: dict[str, Any]) -> list[dict[str, Any]]:
    main = payload.get("main") or []
    if not isinstance(main, list):
        raise ValueError("Liga editions payload is missing main.")
    aux = payload.get("aux") or {}
    grouped: list[Any] = []
    if isinstance(aux, dict):
        for rows in aux.values():
            if isinstance(rows, list):
                grouped.extend(rows)
    return [edition_record(row) for row in [*main, *grouped]]


def load_editions(path: Path) -> list[Any]:
    if not path.is_file():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("liga-editions.json must be a list.")
    return data


def append_missing(
    existing: list[Any], remote: list[dict[str, Any]]
) -> tuple[list[Any], list[dict[str, Any]]]:
    known = {
        item.get("url")
        for item in existing
        if isinstance(item, dict) and isinstance(item.get("url"), str)
    }
    added: list[dict[str, Any]] = []
    for item in remote:
        url = item["url"]
        if url in known:
            continue
        known.add(url)
        added.append(item)
    return [*existing, *added], added


def apply_update(path: Path, remote: list[dict[str, Any]]) -> int:
    existing = load_editions(path)
    updated, added = append_missing(existing, remote)
    if not added:
        return 0
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(updated, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return len(added)


def fetch_editions_payload() -> dict[str, Any]:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            page = browser.new_page()
            page.goto(EDITIONS_URL, wait_until="domcontentloaded", timeout=90_000)
            page.wait_for_function(PAYLOAD_WAIT_JS, timeout=90_000)
            payload = page.evaluate(EXTRACT_JS)
        finally:
            browser.close()

    if not isinstance(payload, dict):
        raise RuntimeError("Could not read Liga editions.")
    return payload


def main() -> int:
    try:
        remote = editions_from_payload(fetch_editions_payload())
    except Exception as exc:
        print(exc, file=sys.stderr)
        return 1
    if not remote:
        print("Liga returned no editions.", file=sys.stderr)
        return 1
    try:
        added = apply_update(editions_path(), remote)
    except ValueError as exc:
        print(exc, file=sys.stderr)
        return 1
    print(json.dumps({"added": added}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
