import json
import sys
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import update_liga_editions as editions  # noqa: E402


def _raw(**overrides: object) -> dict:
    row = {
        "id": "777",
        "acronym": "M5",
        "name": "Abyss Eye",
        "nameen": "Abyss Eye",
        "namept": "",
        "nameptsa": "",
    }
    row.update(overrides)
    return row


class EditionRecordTests(unittest.TestCase):
    def test_builds_search_url_and_unescapes_portuguese_name(self) -> None:
        record = editions.edition_record(
            _raw(
                id="804",
                acronym="30C",
                name="Celebração de 30 Anos",
                nameen="30th Celebration",
                namept="Celebra&ccedil;&atilde;o de 30 Anos",
                nameptsa="Celebracao de 30 Anos",
            )
        )

        self.assertEqual(
            record["url"],
            "https://www.ligapokemon.com.br/?view=cards/search&card=edid=804%20ed=30C",
        )
        self.assertEqual(record["name_pt"], "Celebração de 30 Anos")
        self.assertEqual(record["name_pt_ascii"], "Celebracao de 30 Anos")
        self.assertEqual(record["set_code"], "30C")

    def test_empty_portuguese_names_are_null(self) -> None:
        record = editions.edition_record(_raw())

        self.assertEqual(
            record["url"],
            "https://www.ligapokemon.com.br/?view=cards/search&card=edid=777%20ed=M5",
        )
        self.assertIsNone(record["name_pt"])
        self.assertIsNone(record["name_pt_ascii"])

    def test_payload_keeps_main_then_grouped_editions(self) -> None:
        records = editions.editions_from_payload(
            {
                "main": [_raw()],
                "aux": {
                    "259": [
                        _raw(
                            id="271",
                            acronym="ARTG",
                            name="Estrelas Radiantes - Galeria de Treinadores",
                            nameen="Astral Radiance - Trainer Gallery",
                            namept="Estrelas Radiantes - Galeria de Treinadores",
                            nameptsa="Estrelas Radiantes - Galeria de Treinadores",
                        )
                    ]
                },
            }
        )

        self.assertEqual([row["set_code"] for row in records], ["M5", "ARTG"])


class AppendMissingTests(unittest.TestCase):
    def test_appends_only_urls_that_are_not_already_stored(self) -> None:
        existing = [editions.edition_record(_raw())]
        remote = editions.editions_from_payload(
            {
                "main": [
                    _raw(),
                    _raw(id="806", acronym="M6", name="Storm Emeralda", nameen="Storm Emeralda"),
                    _raw(id="806", acronym="M6", name="Storm Emeralda", nameen="Storm Emeralda"),
                ],
                "aux": {},
            }
        )

        updated, added = editions.append_missing(existing, remote)

        self.assertEqual([row["set_code"] for row in updated], ["M5", "M6"])
        self.assertEqual(len(added), 1)
        self.assertEqual(updated[0], existing[0])

    def test_apply_update_leaves_the_file_untouched_when_nothing_is_missing(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            catalog = Path(tmp) / "liga-editions.json"
            stored = [editions.edition_record(_raw())]
            catalog.write_text(
                json.dumps(stored, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            before = catalog.read_bytes()

            added = editions.apply_update(catalog, stored)

            self.assertEqual(added, 0)
            self.assertEqual(catalog.read_bytes(), before)

    def test_apply_update_appends_a_missing_set(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            catalog = Path(tmp) / "liga-editions.json"
            stored = [editions.edition_record(_raw())]
            catalog.write_text(
                json.dumps(stored, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            remote = [
                *stored,
                editions.edition_record(
                    _raw(id="806", acronym="M6", name="Storm Emeralda", nameen="Storm Emeralda")
                ),
            ]

            added = editions.apply_update(catalog, remote)
            written = json.loads(catalog.read_text(encoding="utf-8"))

            self.assertEqual(added, 1)
            self.assertEqual([row["set_code"] for row in written], ["M5", "M6"])

    def test_rejects_a_catalog_that_is_not_a_list(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            catalog = Path(tmp) / "liga-editions.json"
            catalog.write_text("{}\n", encoding="utf-8")

            with self.assertRaises(ValueError):
                editions.apply_update(catalog, [editions.edition_record(_raw())])


if __name__ == "__main__":
    unittest.main()
