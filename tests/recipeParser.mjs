import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

execFileSync("npx", ["esbuild", "src/recipeParser.ts", "--bundle", "--format=esm", "--target=node20", "--outfile=/tmp/cooking-mode-recipe-parser.mjs"], { stdio: "inherit" });
execFileSync("npx", ["esbuild", "src/localRecipeModel.ts", "--bundle", "--format=esm", "--target=node20", "--outfile=/tmp/cooking-mode-local-recipe-model.mjs"], { stdio: "inherit" });
const parser = await import(pathToFileURL("/tmp/cooking-mode-recipe-parser.mjs"));
const localModel = await import(pathToFileURL("/tmp/cooking-mode-local-recipe-model.mjs"));

test("detects cake recipe from title only", () => {
  assert.equal(parser.isLikelyCookingVideo("How to bake a chocolate cake", ""), true);
});

test("detects recipe from ingredients and units", () => {
  const description = `
Ingredients:
2 cups flour
1 cup sugar
3 eggs

Instructions:
Preheat oven.
Mix until smooth.
Bake for 30 minutes.
`;
  assert.equal(parser.isLikelyCookingVideo("Best dessert", description), true);
});

test("extracts ingredients and procedural steps", () => {
  const recipe = parser.parseRecipe("Cake", "https://youtube.com/watch?v=test", `
Ingredients:
2 cups flour
1 cup sugar
3 eggs

Instructions:
1. Preheat oven to 350F.
2. Mix everything.
3. Bake for 30 minutes.
`);

  assert.deepEqual(recipe.ingredients, ["2 cups flour", "1 cup sugar", "3 eggs"]);
  assert.deepEqual(recipe.instructions, ["Preheat oven to 350F.", "Mix everything.", "Bake for 30 minutes."]);
});

test("extracts cake recipe clues without ingredient heading", () => {
  const recipe = parser.parseRecipe("Bake a vanilla cake with me", "https://youtube.com/watch?v=cake", `
2 cups flour
1 cup sugar
2 eggs
1 tsp vanilla
Preheat the oven to 350F.
Whisk everything together.
Bake for 25 minutes.
Let cool before frosting.
`);

  assert.equal(recipe.likelyCooking, true);
  assert.deepEqual(recipe.ingredients, ["2 cups flour", "1 cup sugar", "2 eggs", "1 tsp vanilla"]);
  assert.deepEqual(recipe.instructions, [
    "Preheat the oven to 350F.",
    "Whisk everything together.",
    "Bake for 25 minutes.",
    "Let cool before frosting."
  ]);
});

test("rejects metadata and transcript scraps as a usable recipe", () => {
  const recipe = parser.parseRecipe("The Most AMAZING Vanilla Cake Recipe", "https://youtube.com/watch?v=cake", `
4,676,413 views May 11, 2021
sprinkle it into your measuring cup
add 1 and 2 3 cups of granulated sugar
`);

  assert.deepEqual(recipe.ingredients, []);
  assert.deepEqual(recipe.instructions, [
    "add 1 and 2 3 cups of granulated sugar"
  ]);
  assert.equal(parser.hasUsableRecipe(recipe), false);
});

test("uses YouTube chapter labels as concise recipe instructions", () => {
  const recipe = parser.parseRecipe("Egg Drop Soup | How To Make Quick And Easy Egg Soup At Home", "https://youtube.com/watch?v=nseYRtHbjNg", `
Ingredients
6 cup unsalted chicken broth
3/4 tsp salt
1/2 tsp sugar
1/2 tbsp soy sauce
1/4 tsp white pepper
1/2 tsp sesame oil
4 tbsp cornstarch
2/3 cup water

Instructions
0:21 - Preparing the green onion, cilantro and egg (How to cook Egg Drop Soup Recipe)
0:39 - Preparing the cornstarch and water mixture (How to cook Egg Drop Soup Recipe)
0:54 - Boiling the chicken broth (How to cook Egg Drop Soup Recipe)
1:19 - Adding the cornstarch and water mixture (How to cook Egg Drop Soup Recipe)
1:50 - Adding the egg (How to cook Egg Drop Soup Recipe)
2:20 - Last step (How to cook Egg Drop Soup Recipe)
Preparing the green onion, cilantro and egg (How to cook Egg Drop Soup Recipe)
Preparing the cornstarch and water mixture (How to cook Egg Drop Soup Recipe)
Cook! Stacey Cook
`);

  assert.deepEqual(recipe.ingredients, [
    "6 cup unsalted chicken broth",
    "3/4 tsp salt",
    "1/2 tsp sugar",
    "1/2 tbsp soy sauce",
    "1/4 tsp white pepper",
    "1/2 tsp sesame oil",
    "4 tbsp cornstarch",
    "2/3 cup water"
  ]);
  assert.deepEqual(recipe.instructions, [
    "Prepare the green onion, cilantro and egg",
    "Prepare the cornstarch and water mixture",
    "Boil the chicken broth",
    "Add the cornstarch and water mixture",
    "Add the egg"
  ]);
  assert.equal(recipe.instructions.some((step) => /white pepper/i.test(step)), false);
  assert.equal(parser.hasUsableRecipe(recipe), true);
});

test("local model does not invent vanilla cake recipe when text is messy", () => {
  const recipe = localModel.extractWithLocalRecipeModel(
    "The Most AMAZING Vanilla Cake Recipe",
    "https://youtube.com/watch?v=cake",
    "4,676,413 views May 11, 2021\nsprinkle it into your measuring cup\nadd 1 and 2 3 cups of granulated sugar",
    ""
  );

  assert.equal(recipe.source, "fallback");
  assert.deepEqual(recipe.ingredients, []);
  assert.deepEqual(recipe.instructions, []);
  assert.equal(recipe.instructions.some((step) => /preheat/i.test(step)), false);
});

test("local model rejects messy caption scraps instead of using title recipe", () => {
  const recipe = localModel.extractWithLocalRecipeModel(
    "The Most AMAZING Vanilla Cake Recipe",
    "https://youtube.com/watch?v=cake",
    "Vanilla cake tutorial",
    "ADD ME ON. add the sugar. add 1 and 2 3 cups of granulated sugar. add three eggs one at a time. add ice cold ingredients into an oven. add the flour."
  );

  assert.equal(recipe.source, "fallback");
  assert.equal(recipe.instructions.some((step) => /ADD ME ON/i.test(step)), false);
  assert.equal(recipe.instructions.some((step) => /preheat/i.test(step)), false);
});

test("local model does not trust description-only add-step scraps", () => {
  const recipe = localModel.extractWithLocalRecipeModel(
    "The Most AMAZING Vanilla Cake Recipe",
    "https://youtube.com/watch?v=EYXQmbZNhy8&t=236s",
    "ADD ME ON:\nadd the sugar\nadd 1 and 2 3 cups of granulated sugar\nadd three eggs in one at a time\nadd the dry mixture\nadd ice cold ingredients into an oven\nadd the flour",
    ""
  );

  assert.equal(recipe.source, "fallback");
  assert.ok(recipe.ingredients.some((item) => /flour/i.test(item)));
  assert.equal(recipe.instructions.some((step) => /ADD ME ON/i.test(step)), false);
  assert.equal(recipe.instructions.some((step) => /preheat/i.test(step)), false);
});

test("detects short-style cake title with sparse text", () => {
  const recipe = parser.parseRecipe("3 ingredient mug cake #shorts", "https://youtube.com/shorts/demo", `
4 tbsp flour
2 tbsp cocoa
3 tbsp milk
Microwave for 90 seconds.
`);

  assert.equal(recipe.likelyCooking, true);
  assert.deepEqual(recipe.ingredients, ["4 tbsp flour", "2 tbsp cocoa", "3 tbsp milk"]);
  assert.deepEqual(recipe.instructions, ["Microwave for 90 seconds."]);
});

test("detects broad savory recipe tutorial", () => {
  const analysis = parser.analyzeRecipeVideo("How to make chicken curry from scratch", `
Ingredients
2 tbsp oil
1 onion
500g chicken
Instructions
Simmer until tender.
`);

  assert.equal(analysis.likely, true);
  assert.ok(analysis.score >= 7);
});

test("detects steak recipe tutorial", () => {
  const analysis = parser.analyzeRecipeVideo("Perfect steak recipe | how to cook ribeye", `
Ingredients:
1 lb ribeye steak
1 tbsp butter
2 cloves garlic
Instructions:
Sear the steak, baste with butter, and rest before slicing.
`);

  assert.equal(analysis.likely, true);
});

test("detects Gordon Ramsay perfect steak tutorial title", () => {
  const analysis = parser.analyzeRecipeVideo("Gordon Ramsay's ULTIMATE COOKERY COURSE: How to Cook the Perfect Steak", "");
  assert.equal(analysis.likely, true);
});

test("detects cake cooking title without recipe word", () => {
  const analysis = parser.analyzeRecipeVideo("The moistest chocolate cake I ever baked", "rich frosting and fluffy layers");
  assert.equal(analysis.likely, true);
});

test("detects steak cooking title without recipe word", () => {
  const analysis = parser.analyzeRecipeVideo("Perfect juicy ribeye steak at home", "butter basted and rested before slicing");
  assert.equal(analysis.likely, true);
});

test("detects simple dish title with cooking context", () => {
  const analysis = parser.analyzeRecipeVideo("Creamy garlic pasta", "boil pasta, simmer sauce, add parmesan");
  assert.equal(analysis.likely, true);
});

test("marks local model parsing source and usability", () => {
  const recipe = parser.parseRecipeFromText("Perfect steak", "https://youtube.com/watch?v=steak", `
1 lb ribeye steak
1 tbsp butter
2 cloves garlic
Sear the steak in a hot pan.
Baste with butter and garlic.
Rest before slicing.
`, "local-model");

  assert.equal(recipe.source, "local-model");
  assert.equal(parser.hasUsableRecipe(recipe), true);
});

test("local model extracts steak recipe from spoken captions", () => {
  const recipe = localModel.extractWithLocalRecipeModel(
    "How to cook the perfect steak",
    "https://youtube.com/watch?v=steak",
    "Watch Gordon cook steak.",
    "First take a ribeye steak and season it heavily with salt and black pepper. Add olive oil to a very hot pan. Sear the steak on both sides. Add butter garlic and thyme to the pan. Baste the steak with the foaming butter. Rest the steak for five minutes before slicing and serving."
  );

  assert.equal(recipe.source, "local-model");
  assert.ok(recipe.ingredients.some((item) => item.includes("ribeye") || item.includes("steak")));
  assert.ok(recipe.ingredients.some((item) => item.includes("butter")));
  assert.ok(recipe.ingredients.some((item) => item.includes("garlic")));
  assert.ok(recipe.instructions.some((step) => /sear/i.test(step)));
  assert.ok(recipe.instructions.some((step) => /rest/i.test(step)));
});

test("local model does not invent steak instructions from weak caption scraps", () => {
  const recipe = localModel.extractWithLocalRecipeModel(
    "The Best Steak You'll Ever Make (Restaurant-Quality) | Epicurious 101",
    "https://youtube.com/watch?v=steak",
    "Epicurious steak tutorial",
    "From browning the meat to letting it rest, your steaks will never be sad and dry again. Frank Proto demonstrates proper technique for selecting and preparing a thick-cut New York strip steak."
  );

  assert.equal(recipe.source, "fallback");
  assert.equal(recipe.ingredients.some((item) => /^apple$/i.test(item)), false);
  assert.equal(recipe.instructions.some((step) => /pat.*dry/i.test(step)), false);
  assert.equal(recipe.instructions.some((step) => /sear/i.test(step)), false);
  assert.equal(recipe.instructions.some((step) => /rest/i.test(step)), false);
  assert.equal(recipe.instructions.some((step) => /never be sad|demonstrates proper technique/i.test(step)), false);
});

test("local model uses transcript when description only has ingredients and chapters", () => {
  const recipe = localModel.extractWithLocalRecipeModel(
    "Egg Drop Soup | How To Make Quick And Easy Egg Soup At Home",
    "https://youtube.com/watch?v=nseYRtHbjNg",
    `Ingredients
6 cup unsalted chicken broth
3/4 tsp salt
1/2 tsp sugar
1/2 tbsp soy sauce
1/4 tsp white pepper
1/2 tsp sesame oil
4 tbsp cornstarch
2/3 cup water

Instructions
0:21 - Preparing the green onion, cilantro and egg (How to cook Egg Drop Soup Recipe)
0:39 - Preparing the cornstarch and water mixture (How to cook Egg Drop Soup Recipe)
0:54 - Boiling the chicken broth (How to cook Egg Drop Soup Recipe)
1:19 - Adding the cornstarch and water mixture (How to cook Egg Drop Soup Recipe)
1:50 - Adding the egg (How to cook Egg Drop Soup Recipe)
2:20 - Last step (How to cook Egg Drop Soup Recipe)`,
    "Beat the eggs in a bowl. Mix cornstarch with water to make a slurry. Bring unsalted chicken broth to a boil. Season the broth with salt sugar soy sauce white pepper and sesame oil. Stir in the cornstarch slurry until the soup thickens. Slowly pour in the beaten egg while stirring to make ribbons. Garnish with green onion and cilantro and serve hot."
  );

  assert.equal(recipe.source, "local-model");
  assert.ok(recipe.ingredients.some((item) => /chicken broth/i.test(item)), recipe.ingredients.join(", "));
  assert.ok(recipe.ingredients.some((item) => /soy sauce/i.test(item)), recipe.ingredients.join(", "));
  assert.ok(recipe.ingredients.some((item) => /egg/i.test(item)), recipe.ingredients.join(", "));
  assert.ok(recipe.instructions.some((step) => /cornstarch slurry/i.test(step)), recipe.instructions.join(" | "));
  assert.ok(recipe.instructions.some((step) => /pour.*egg/i.test(step)), recipe.instructions.join(" | "));
  assert.equal(recipe.instructions.some((step) => /0:21|Preparing the green onion|Last step|Stacey Cook/i.test(step)), false);
});

test("local model shows only supported soup ingredients when captions are missing or YouTube UI text", () => {
  const recipe = localModel.extractWithLocalRecipeModel(
    "Egg Drop Soup | How To Make Quick And Easy Egg Soup At Home",
    "https://youtube.com/watch?v=nseYRtHbjNg",
    `Ingredients
6 cup unsalted chicken broth
3/4 tsp salt
1/2 tsp sugar
1/2 tbsp soy sauce
1/4 tsp white pepper
1/2 tsp sesame oil
4 tbsp cornstarch
2/3 cup water
0:21 - Preparing the green onion, cilantro and egg (How to cook Egg Drop Soup Recipe)
0:39 - Preparing the cornstarch and water mixture (How to cook Egg Drop Soup Recipe)
0:54 - Boiling the chicken broth (How to cook Egg Drop Soup Recipe)
1:19 - Adding the cornstarch and water mixture (How to cook Egg Drop Soup Recipe)
1:50 - Adding the egg (How to cook Egg Drop Soup Recipe)
Simple seasonings and fresh ingredients yield a savory soup full of umami flavor in less than 15 minutes
Show transcript Cook
Stacey Cook Videos About Show less`,
    ""
  );

  assert.equal(recipe.source, "description");
  assert.ok(recipe.ingredients.some((item) => /6 cup unsalted chicken broth/i.test(item)), recipe.ingredients.join(", "));
  assert.equal(recipe.ingredients.some((item) => /egg/i.test(item)), false);
  assert.equal(recipe.ingredients.some((item) => /green onions?/i.test(item)), false);
  assert.deepEqual(recipe.instructions, [
    "Prepare the green onion, cilantro and egg",
    "Prepare the cornstarch and water mixture",
    "Boil the chicken broth",
    "Add the cornstarch and water mixture",
    "Add the egg"
  ]);
  assert.equal(recipe.instructions.some((step) => /white pepper/i.test(step)), false);
  assert.equal(recipe.instructions.some((step) => /show transcript|stacey cook|videos about|show less/i.test(step)), false);
});

test("local model handles baking captions", () => {
  const recipe = localModel.extractWithLocalRecipeModel(
    "Easy vanilla cake",
    "https://youtube.com/watch?v=cake",
    "Cake tutorial",
    "We need flour sugar eggs milk butter vanilla and baking powder. First preheat the oven to 350 degrees. Mix the flour sugar and baking powder. Add eggs milk melted butter and vanilla. Whisk until smooth. Pour into the pan and bake for thirty minutes. Cool before serving."
  );

  assert.equal(recipe.source, "local-model");
  for (const ingredient of ["flour", "sugar", "eggs", "milk", "butter", "vanilla", "baking powder"]) {
    assert.ok(recipe.ingredients.some((item) => item.includes(ingredient.replace(/s$/, ""))), ingredient);
  }
  assert.ok(recipe.instructions.some((step) => /preheat/i.test(step)));
  assert.ok(recipe.instructions.some((step) => /bake/i.test(step)));
});

test("local model handles savory pasta captions", () => {
  const recipe = localModel.extractWithLocalRecipeModel(
    "Creamy garlic pasta",
    "https://youtube.com/watch?v=pasta",
    "Pasta dinner",
    "Use pasta garlic butter cream parmesan salt and pepper. Boil the pasta until tender. Melt butter in a pan. Add garlic and cook for thirty seconds. Pour in cream and simmer. Stir in parmesan. Toss the pasta with the sauce and serve."
  );

  assert.equal(recipe.source, "local-model");
  for (const ingredient of ["pasta", "garlic", "butter", "cream", "parmesan"]) {
    assert.ok(recipe.ingredients.some((item) => item.includes(ingredient)), ingredient);
  }
  assert.ok(recipe.instructions.some((step) => /boil/i.test(step)));
  assert.ok(recipe.instructions.some((step) => /simmer/i.test(step)));
});

test("rejects food challenge without recipe signals", () => {
  const analysis = parser.analyzeRecipeVideo("Eating only cake for 24 hours challenge", "funny food challenge vlog");
  assert.equal(analysis.likely, false);
});

test("rejects game cake content", () => {
  const analysis = parser.analyzeRecipeVideo("Minecraft cake build tutorial", "gameplay block tutorial");
  assert.equal(analysis.likely, false);
});
