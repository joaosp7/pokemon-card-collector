import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import {
  catalogDbPath,
  dataDir,
  ownershipDbPath,
  projectRelativePath,
  repoRoot,
  resolveProjectPath,
} from "../lib/data-paths";

describe("repository data paths", () => {
  test("resolves catalog and ownership databases at the repository root from web/", () => {
    assert.equal(path.basename(process.cwd()), "web");
    const root = path.resolve(process.cwd(), "..");
    assert.equal(repoRoot(), root);
    assert.equal(dataDir(), path.resolve(process.cwd(), "..", "data"));
    assert.equal(catalogDbPath(), path.join(root, "data", "catalog.db"));
    assert.equal(ownershipDbPath(), path.join(root, "data", "ownership.db"));
    assert.equal(path.dirname(catalogDbPath()), dataDir());
    assert.equal(path.dirname(ownershipDbPath()), dataDir());
    assert.equal(
      path.relative(root, catalogDbPath()),
      path.join("data", "catalog.db"),
    );
    assert.equal(
      path.relative(root, ownershipDbPath()),
      path.join("data", "ownership.db"),
    );
  });

  test("keeps image and logo paths relative to the repository root", () => {
    const image = "cards/Storm-Emeralda-M6/001_G_Weedle.jpg";
    const logo = "cards/Storm-Emeralda-M6/logo.png";
    assert.equal(projectRelativePath(image), image);
    assert.equal(projectRelativePath(logo), logo);
    assert.equal(path.isAbsolute(projectRelativePath(image)), false);
    assert.equal(path.isAbsolute(projectRelativePath(logo)), false);
    assert.equal(resolveProjectPath(image), path.resolve(repoRoot(), image));
    assert.equal(resolveProjectPath(logo), path.resolve(repoRoot(), logo));
    assert.equal(path.relative(repoRoot(), resolveProjectPath(image)), image);
    assert.equal(path.relative(repoRoot(), resolveProjectPath(logo)), logo);
    assert.throws(() => projectRelativePath("../outside.jpg"), /repository/);
  });
});
