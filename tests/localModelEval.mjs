import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

execFileSync("npx", ["esbuild", "src/localRecipeModel.ts", "--bundle", "--format=esm", "--target=node20", "--outfile=/tmp/cooking-mode-local-model-eval.mjs"], { stdio: "inherit" });
const localModel = await import(pathToFileURL("/tmp/cooking-mode-local-model-eval.mjs"));
const evalData = JSON.parse(await readFile("model/localRecipeEvalData.json", "utf8"));

test("local model eval meets recall floor across recipe styles", () => {
  for (const fixture of evalData.positive) {
    const recipe = localModel.extractWithLocalRecipeModel(fixture.title, "https://youtube.com/watch?v=eval", "", fixture.transcript);
    const ingredientRecall = recall(fixture.ingredients, recipe.ingredients);
    const ingredientPrecision = precision(fixture.ingredients, recipe.ingredients);
    const stepRecall = recall(fixture.steps, recipe.instructions);
    const stepPrecision = precision(fixture.steps, recipe.instructions);

    assert.ok(ingredientRecall >= evalData.thresholds.ingredientRecall, `${fixture.id} ingredient recall ${ingredientRecall}: ${recipe.ingredients.join(", ")}`);
    assert.ok(ingredientPrecision >= evalData.thresholds.ingredientPrecision, `${fixture.id} ingredient precision ${ingredientPrecision}: ${recipe.ingredients.join(", ")}`);
    assert.ok(stepRecall >= evalData.thresholds.stepRecall, `${fixture.id} step recall ${stepRecall}: ${recipe.instructions.join(" | ")}`);
    assert.ok(stepPrecision >= evalData.thresholds.stepPrecision, `${fixture.id} step precision ${stepPrecision}: ${recipe.instructions.join(" | ")}`);
    assert.ok(recipe.modelConfidence >= evalData.thresholds.positiveConfidence, `${fixture.id} confidence ${recipe.modelConfidence}`);
  }
});

test("local model does not turn food chatter into a fake recipe", () => {
  for (const fixture of evalData.negative) {
    const recipe = localModel.extractWithLocalRecipeModel(fixture.title, "https://youtube.com/watch?v=eval", "", fixture.transcript);
    assert.equal(recipe.ingredients.length, 0, `${fixture.title} ingredients: ${recipe.ingredients.join(", ")}`);
    assert.equal(recipe.instructions.length, 0, `${fixture.title} steps: ${recipe.instructions.join(" | ")}`);
    assert.equal(recipe.source, "fallback");
    assert.ok(recipe.modelConfidence <= evalData.thresholds.negativeConfidence, `${fixture.title} confidence ${recipe.modelConfidence}`);
  }
});

test("local model infers a recipe for title-only cooking tutorials", () => {
  const recipe = localModel.extractWithLocalRecipeModel("How To Cook The Perfect Steak", "https://youtube.com/watch?v=eval", "", "");
  assert.equal(recipe.source, "local-model");
  assert.ok(recipe.ingredients.some((item) => /steak/i.test(item)), `Missing steak: ${recipe.ingredients.join(", ")}`);
  assert.ok(recipe.instructions.some((step) => /sear/i.test(step)), `Missing sear: ${recipe.instructions.join(" | ")}`);
  assert.ok(recipe.instructions.some((step) => /rest/i.test(step)), `Missing rest: ${recipe.instructions.join(" | ")}`);
  assert.ok(recipe.modelConfidence >= 0.7, `Low confidence: ${recipe.modelConfidence}`);
});

test("local model skips title-only food-adjacent videos without tutorial intent", () => {
  const recipe = localModel.extractWithLocalRecipeModel("Steakhouse review in New York", "https://youtube.com/watch?v=eval", "", "");
  assert.equal(recipe.source, "fallback");
  assert.equal(recipe.ingredients.length, 0);
  assert.equal(recipe.instructions.length, 0);
});

function recall(expected, actual) {
  const hits = expected.filter((expectedItem) => actual.some((actualItem) => matches(actualItem, expectedItem)));
  return hits.length / expected.length;
}

function precision(expected, actual) {
  if (!actual.length) return 0;
  const hits = actual.filter((actualItem) => expected.some((expectedItem) => matches(actualItem, expectedItem)));
  return hits.length / actual.length;
}

function matches(actualItem, expectedItem) {
  const actual = singularize(actualItem.toLowerCase());
  const expected = singularize(expectedItem.toLowerCase());
  return actual.includes(expected) || expected.includes(actual);
}

function singularize(value) {
  return value.replace(/\b([a-z]{4,})s\b/g, "$1");
}
