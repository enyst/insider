// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { buildBundle } from "./build.mjs";

it("ships the exact standalone bundle generated from source and the canonical Insider skill", async () => {
  const manifest = JSON.parse(
    readFileSync(new URL("canvas-extension.json", import.meta.url), "utf8"),
  );
  const bundle = readFileSync(
    new URL(manifest.entrypoint, import.meta.url),
    "utf8",
  );
  expect(bundle).toBe(await buildBundle());
  expect(bundle).not.toContain("__INSIDER_SKILL_TEXT__");
  expect(bundle).not.toMatch(/^import\s/m);
});
