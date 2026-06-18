import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

test("generated local model weights are in sync with training data", async () => {
  const before = await readFile("src/localRecipeModelWeights.ts", "utf8");
  execFileSync("npm", ["run", "train:model"], { stdio: "inherit" });
  const after = await readFile("src/localRecipeModelWeights.ts", "utf8");
  assert.equal(after, before);
});
