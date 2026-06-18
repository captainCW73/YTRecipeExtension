import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

execFileSync("npx", ["esbuild", "src/localRecipeModel.ts", "--bundle", "--format=esm", "--target=node20", "--outfile=/tmp/cooking-mode-local-model-cli-eval.mjs"], { stdio: "inherit" });
const localModel = await import(pathToFileURL("/tmp/cooking-mode-local-model-cli-eval.mjs"));
const evalData = JSON.parse(await readFile("model/localRecipeEvalData.json", "utf8"));

const positiveRows = evalData.positive.map((fixture) => {
  const recipe = localModel.extractWithLocalRecipeModel(fixture.title, "https://youtube.com/watch?v=eval", "", fixture.transcript);
  return {
    id: fixture.id,
    ingredientRecall: recall(fixture.ingredients, recipe.ingredients),
    ingredientPrecision: precision(fixture.ingredients, recipe.ingredients),
    stepRecall: recall(fixture.steps, recipe.instructions),
    stepPrecision: precision(fixture.steps, recipe.instructions),
    confidence: recipe.modelConfidence || 0,
    ingredients: recipe.ingredients,
    steps: recipe.instructions
  };
});

const negativeRows = evalData.negative.map((fixture) => {
  const recipe = localModel.extractWithLocalRecipeModel(fixture.title, "https://youtube.com/watch?v=eval", "", fixture.transcript);
  return {
    id: fixture.id,
    falseRecipe: recipe.ingredients.length > 0 || recipe.instructions.length > 0,
    confidence: recipe.modelConfidence || 0,
    ingredients: recipe.ingredients,
    steps: recipe.instructions
  };
});

const aggregate = {
  ingredientRecall: average(positiveRows.map((row) => row.ingredientRecall)),
  ingredientPrecision: average(positiveRows.map((row) => row.ingredientPrecision)),
  stepRecall: average(positiveRows.map((row) => row.stepRecall)),
  stepPrecision: average(positiveRows.map((row) => row.stepPrecision)),
  positiveConfidence: average(positiveRows.map((row) => row.confidence)),
  negativeConfidence: average(negativeRows.map((row) => row.confidence)),
  negativeFalseRecipeRate: negativeRows.filter((row) => row.falseRecipe).length / Math.max(negativeRows.length, 1)
};

const failures = [
  ...positiveRows.flatMap((row) => [
    row.ingredientRecall >= evalData.thresholds.ingredientRecall ? "" : `${row.id} ingredient recall ${row.ingredientRecall}`,
    row.ingredientPrecision >= evalData.thresholds.ingredientPrecision ? "" : `${row.id} ingredient precision ${row.ingredientPrecision}`,
    row.stepRecall >= evalData.thresholds.stepRecall ? "" : `${row.id} step recall ${row.stepRecall}`,
    row.stepPrecision >= evalData.thresholds.stepPrecision ? "" : `${row.id} step precision ${row.stepPrecision}`,
    row.confidence >= evalData.thresholds.positiveConfidence ? "" : `${row.id} confidence ${row.confidence}`
  ]),
  ...negativeRows.map((row) => row.confidence <= evalData.thresholds.negativeConfidence ? "" : `${row.id} negative confidence ${row.confidence}`),
  aggregate.negativeFalseRecipeRate <= evalData.thresholds.negativeFalseRecipeRate ? "" : `negative false recipe rate ${aggregate.negativeFalseRecipeRate}`
].filter(Boolean);

console.log(JSON.stringify({ aggregate, positiveRows, negativeRows, failures }, null, 2));

if (failures.length) process.exitCode = 1;

function recall(expected, actual) {
  const hits = expected.filter((expectedItem) => actual.some((actualItem) => matches(actualItem, expectedItem)));
  return hits.length / expected.length;
}

function precision(expected, actual) {
  if (!actual.length) return 0;
  const hits = actual.filter((actualItem) => expected.some((expectedItem) => matches(actualItem, expectedItem)));
  return hits.length / actual.length;
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function matches(actualItem, expectedItem) {
  const actual = singularize(actualItem.toLowerCase());
  const expected = singularize(expectedItem.toLowerCase());
  return actual.includes(expected) || expected.includes(actual);
}

function singularize(value) {
  return value.replace(/\b([a-z]{4,})s\b/g, "$1");
}
