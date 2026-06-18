import type { RecipePayload, RecipeSource, RecipeVideoAnalysis } from "./types";

const foodWords = [
  "cake",
  "cupcake",
  "brownie",
  "cookie",
  "bread",
  "sourdough",
  "muffin",
  "pie",
  "tart",
  "cheesecake",
  "dessert",
  "frosting",
  "icing",
  "buttercream",
  "chocolate",
  "vanilla",
  "flour",
  "sugar",
  "butter",
  "eggs",
  "pasta",
  "noodles",
  "rice",
  "chicken",
  "beef",
  "steak",
  "ribeye",
  "sirloin",
  "filet",
  "filet mignon",
  "pork",
  "fish",
  "salmon",
  "shrimp",
  "tofu",
  "soup",
  "stew",
  "curry",
  "sauce",
  "salad",
  "sandwich",
  "pizza",
  "taco",
  "burger",
  "dumpling",
  "biryani",
  "ramen",
  "lasagna",
  "omelette",
  "pancake",
  "waffle",
  "smoothie"
];

const tutorialWords = [
  "recipe",
  "ingredients",
  "directions",
  "instructions",
  "method",
  "tutorial",
  "cookery",
  "cookery course",
  "chef",
  "how to make",
  "how to cook",
  "how to bake",
  "make with me",
  "cook with me",
  "bake with me",
  "from scratch",
  "homemade",
  "step by step",
  "easy dinner",
  "meal prep",
  "prep",
  "preheat",
  "cook",
  "cooking",
  "bake",
  "baking",
  "baked",
  "roast",
  "simmer",
  "boil",
  "fry",
  "whisk",
  "mix",
  "fold",
  "knead",
  "oven",
  "microwave",
  "air fry",
  "air fryer",
  "meal",
  "dish",
  "kitchen"
];

const negativeWords = [
  "minecraft",
  "roblox",
  "asmr eating",
  "mukbang",
  "food challenge",
  "try not to",
  "song",
  "music video",
  "reaction",
  "review",
  "restaurant review",
  "eating only",
  "tier list",
  "compilation",
  "cartoon",
  "toy",
  "gameplay",
  "cooking simulator"
];

const titleCookingIntent = /\b(how i|i made|i cooked|i baked|making|cooking|baking|grilling|smoking|roasting|searing|frying|perfect|best|easy|quick|simple|juicy|tender|crispy|moist|fluffy|creamy|delicious|restaurant style|better than|ultimate)\b/i;

const titleDishPattern = /\b(cake|steak|ribeye|sirloin|filet|pasta|chicken|beef|pork|salmon|shrimp|tofu|curry|soup|stew|pizza|taco|burger|bread|cookie|brownie|pancake|waffle|lasagna|ramen|biryani|dumpling|omelette)\b/i;

const sectionMarkers = {
  ingredients: ["ingredients", "ingredient list", "what you need"],
  instructions: ["instructions", "directions", "method", "steps", "preparation", "recipe"]
};

export function isLikelyCookingVideo(title: string, description: string): boolean {
  return analyzeRecipeVideo(title, description).likely;
}

export function analyzeRecipeVideo(title: string, description: string): RecipeVideoAnalysis {
  const text = `${title}\n${description}`.toLowerCase();
  const titleText = title.toLowerCase();
  let score = 0;
  const reasons: string[] = [];

  const negativeMatches = negativeWords.filter((keyword) => text.includes(keyword));
  if (negativeMatches.length > 0) {
    score -= negativeMatches.length * 3;
    reasons.push(`negative:${negativeMatches.join(",")}`);
  }

  const foodMatches = foodWords.filter((keyword) => includesPhrase(text, keyword));
  if (foodMatches.length > 0) {
    score += Math.min(foodMatches.length, 5);
    reasons.push(`food:${foodMatches.slice(0, 5).join(",")}`);
  }

  const titleFoodMatches = foodWords.filter((keyword) => includesPhrase(titleText, keyword));
  if (titleFoodMatches.length > 0) {
    score += Math.min(titleFoodMatches.length * 2, 6);
    reasons.push(`title-food:${titleFoodMatches.slice(0, 4).join(",")}`);
  }

  const tutorialMatches = tutorialWords.filter((keyword) => includesPhrase(text, keyword));
  if (tutorialMatches.length > 0) {
    score += Math.min(tutorialMatches.length * 2, 8);
    reasons.push(`tutorial:${tutorialMatches.slice(0, 5).join(",")}`);
  }

  if (/\b(recipe|how to make|how to cook|how to bake|from scratch|homemade|step by step)\b/i.test(titleText)) {
    score += 5;
    reasons.push("title-tutorial");
  }

  if (titleDishPattern.test(titleText) && titleCookingIntent.test(titleText)) {
    score += 6;
    reasons.push("title-dish-intent");
  }

  if (titleDishPattern.test(titleText) && !/\b(review|challenge|mukbang|reaction|compilation|tier list|gameplay)\b/i.test(titleText)) {
    score += 3;
    reasons.push("title-dish");
  }

  if (/\b\d+\s?(g|kg|mg|ml|l|tbsp|tsp|cups?|oz|lb|pounds?|grams?|tablespoons?|teaspoons?)\b/i.test(text)) {
    score += 4;
    reasons.push("measurements");
  }

  if (/\b(ingredients?|directions?|instructions?|method|steps?|makes|serves|prep time|cook time|bake time)\b/i.test(description)) {
    score += 5;
    reasons.push("recipe-section");
  }

  if (/\b(preheat|oven|bake for|mix until|whisk|combine|add the|let cool|microwave|air fry|simmer|knead|marinate)\b/i.test(text)) {
    score += 3;
    reasons.push("cooking-actions");
  }

  const likely = score >= 7 || (score >= 5 && titleFoodMatches.length > 0 && (tutorialMatches.length > 0 || titleCookingIntent.test(titleText)));
  return { likely, score, reasons };
}

export function parseRecipe(title: string, url: string, description: string): RecipePayload {
  return parseRecipeFromText(title, url, description, "description");
}

export function parseRecipeFromText(title: string, url: string, text: string, source: RecipeSource, sourceNote?: string): RecipePayload {
  const cleaned = cleanRecipeText(text);
  const lines = cleaned.split("\n").map((line) => line.trim()).filter(Boolean);
  const ingredients = extractIngredients(lines).filter(isRecipeIngredient);
  const instructions = extractInstructions(lines).filter(isRecipeStep);

  return {
    title: title || "Recipe",
    url,
    ingredients,
    instructions,
    fallbackText: cleaned,
    extractedAt: Date.now(),
    likelyCooking: analyzeRecipeVideo(title, text).likely,
    source,
    sourceNote
  };
}

export function hasUsableRecipe(recipe: RecipePayload): boolean {
  const ingredients = recipe.ingredients.filter(isRecipeIngredient);
  const instructions = recipe.instructions.filter(isRecipeStep);
  const duplicateCount = ingredients.filter((ingredient) => instructions.some((step) => similarRecipeText(ingredient, step))).length;
  if (duplicateCount >= Math.min(ingredients.length, instructions.length) && instructions.length <= 2) return false;
  return ingredients.length >= 2 && instructions.length >= 2;
}

function includesPhrase(text: string, phrase: string): boolean {
  return new RegExp(`\\b${escapeRegExp(phrase).replace(/\\ /g, "\\s+")}\\b`, "i").test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function cleanRecipeText(text: string): string {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line && !isPromoLine(line) && !isMetadataLine(line))
    .join("\n")
    .trim();
}

function isPromoLine(line: string): boolean {
  return /^(http|www\.|#|@)|subscribe|follow me|instagram|tiktok|facebook|affiliate|sponsored|merch|chapters?|timestamps?/i.test(line);
}

function isMetadataLine(line: string): boolean {
  return /^\d[\d,.\s]*(views?|likes?|comments?)\b/i.test(line)
    || /\b(views?|subscribers?|joined|premiered|published|streamed live|license|category)\b/i.test(line)
    || /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},\s+\d{4}\b/i.test(line);
}

function extractSection(lines: string[], starts: string[], stops: string[], predicate: (line: string) => boolean): string[] {
  const startIndex = lines.findIndex((line) => starts.some((marker) => isHeading(line, marker)));
  if (startIndex === -1) return [];

  const result: string[] = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (stops.some((marker) => isHeading(line, marker)) && result.length > 0) break;
    if (predicate(line)) result.push(stripBulletPrefix(line));
    if (result.length >= 40) break;
  }
  return dedupe(result);
}

function extractIngredients(lines: string[]): string[] {
  const fromSection = extractSection(lines, sectionMarkers.ingredients, sectionMarkers.instructions, looksLikeIngredient);
  if (fromSection.length > 0) return fromSection;

  const likelyIngredients = lines.filter((line) => looksLikeIngredient(line)).map(stripBulletPrefix);
  return dedupe(likelyIngredients).slice(0, 40);
}

function extractInstructions(lines: string[]): string[] {
  const fromSection = extractInstructionSection(lines, sectionMarkers.instructions, ["notes", "tips", "nutrition", "chapters"]);
  if (fromSection.length > 0) return fromSection.slice(0, 30);

  const numbered = lines
    .filter((line) => /^\s*(\d+[.)]|step\s+\d+)/i.test(line))
    .map(normalizeInstructionLine)
    .filter(isRecipeStep);
  if (numbered.length > 0) return dedupe(numbered).slice(0, 30);

  const procedural = lines
    .filter(shouldUseInstructionLine)
    .map(normalizeInstructionLine)
    .filter(isRecipeStep);
  if (procedural.length > 0) return dedupe(procedural).slice(0, 20);

  return [];
}

function extractInstructionSection(lines: string[], starts: string[], stops: string[]): string[] {
  const startIndex = lines.findIndex((line) => starts.some((marker) => isHeading(line, marker)));
  if (startIndex === -1) return [];

  const result: string[] = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (stops.some((marker) => isHeading(line, marker)) && result.length > 0) break;
    if (shouldUseInstructionLine(line)) result.push(normalizeInstructionLine(line));
    if (result.length >= 40) break;
  }
  return dedupe(result);
}

function isHeading(line: string, marker: string): boolean {
  const normalized = line.toLowerCase().replace(/[:\-–—]+$/g, "").trim();
  return normalized === marker || normalized.startsWith(`${marker}:`);
}

function looksLikeIngredient(line: string): boolean {
  if (isBadRecipeItem(line)) return false;
  if (/^\d{1,2}:\d{2}/.test(line)) return false;
  if (line.length > 120) return false;
  if (/^\s*(add|sprinkle|mix|whisk|combine|pour|bake|cook|cool|serve|frost|decorate)\b/i.test(stripBulletPrefix(line))) return false;
  const hasMeasure = /\b(tsp|tbsp|tablespoons?|teaspoons?|cups?|grams?|g|kg|ml|liters?|ounces?|oz|pounds?|lbs?|lb|cloves?|pinch)\b/i.test(line);
  const startsMeasured = /^[-*•]?\s*(\d+|[¼½¾⅓⅔⅛⅜⅝⅞]|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(line);
  return hasMeasure || (startsMeasured && hasFoodWord(line));
}

function looksLikeInstruction(line: string): boolean {
  if (isBadRecipeItem(line)) return false;
  return /\b(preheat|prepare|prep|boil|stir|mix|whisk|combine|add|pour|bake|cook|cool|serve|frost|microwave|air fry|broil|rest|chill|decorate|fold|beat|cream|sift|grease|line|sear|baste|season|slice)\b/i.test(line)
    && line.length <= 220;
}

function isRecipeIngredient(line: string): boolean {
  return looksLikeIngredient(line) && !looksLikeInstruction(line);
}

function isRecipeStep(line: string): boolean {
  return looksLikeInstruction(line);
}

function isBadRecipeItem(line: string): boolean {
  return isMetadataLine(line)
    || /\b(measuring cups?|mixing bowl|stand mixer|hand mixer|oven rack|views?|subscribers?|comments?|watch next)\b/i.test(line)
    || /^cook!\s+\w+/i.test(line);
}

function hasFoodWord(line: string): boolean {
  return foodWords.some((word) => includesPhrase(line.toLowerCase(), word));
}

function similarRecipeText(left: string, right: string): boolean {
  const a = left.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const b = right.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

function stripListPrefix(line: string): string {
  return stripBulletPrefix(line).replace(/^(step\s+)?\d+[.)]?\s*/i, "").trim();
}

function stripBulletPrefix(line: string): string {
  return line.replace(/^[-*•]\s*/, "").trim();
}

function shouldUseInstructionLine(line: string): boolean {
  const normalized = normalizeInstructionLine(line);
  if (!looksLikeInstruction(normalized)) return false;
  if (isTimestampChapterLine(line) && isThinChapterInstruction(normalized)) return false;
  if (hasRecipeTitleParenthetical(line) && isThinChapterInstruction(normalized)) return false;
  return true;
}

function normalizeInstructionLine(line: string): string {
  return normalizeGerundInstruction(
    stripRecipeTitleParenthetical(stripTimestampPrefix(stripListPrefix(line)))
      .replace(/\s*[-–—]\s*$/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function stripTimestampPrefix(line: string): string {
  return line.replace(/^\s*(?:(?:\d{1,2}:)?\d{1,2}:\d{2}|:\d{2})\s*[-–—.]?\s*/i, "").trim();
}

function stripRecipeTitleParenthetical(line: string): string {
  return line.replace(/\s*\([^)]*\b(?:recipe|how to cook|how to make|youtube|video)\b[^)]*\)\s*/gi, " ").trim();
}

function hasRecipeTitleParenthetical(line: string): boolean {
  return /\([^)]*\b(?:recipe|how to cook|how to make|youtube|video)\b[^)]*\)/i.test(line);
}

function isTimestampChapterLine(line: string): boolean {
  return /^\s*(?:(?:\d{1,2}:)?\d{1,2}:\d{2}|:\d{2})\s*[-–—.]?/i.test(stripBulletPrefix(line));
}

function normalizeGerundInstruction(line: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/^preparing\b/i, "Prepare"],
    [/^adding\b/i, "Add"],
    [/^boiling\b/i, "Boil"],
    [/^mixing\b/i, "Mix"],
    [/^whisking\b/i, "Whisk"],
    [/^stirring\b/i, "Stir"],
    [/^cooking\b/i, "Cook"],
    [/^baking\b/i, "Bake"],
    [/^chopping\b/i, "Chop"],
    [/^cutting\b/i, "Cut"],
    [/^slicing\b/i, "Slice"],
    [/^frying\b/i, "Fry"],
    [/^searing\b/i, "Sear"],
    [/^serving\b/i, "Serve"],
    [/^garnishing\b/i, "Garnish"],
    [/^seasoning\b/i, "Season"]
  ];
  for (const [pattern, replacement] of replacements) {
    if (pattern.test(line)) return line.replace(pattern, replacement);
  }
  return line;
}

function isThinChapterInstruction(line: string): boolean {
  const normalized = line.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return true;
  if (/^(intro|outro|last step|final step|next step|first step|cook|recipe|ingredients?)$/.test(normalized)) return true;
  const startsLikeChapter = /^(prepare|add|boil|mix|whisk|stir|cook|bake|chop|cut|slice|fry|sear|serve|garnish|season)\b/i.test(line);
  if (!startsLikeChapter) return false;
  const hasCookingDetail = /\b(\d+|for|until|with|over|into|in a|in the|medium|low|high|minutes?|seconds?|degrees?|smooth|tender|golden|thick|thin|translucent|fragrant|coat|combined)\b/i.test(line);
  return !hasCookingDetail && line.length < 90;
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
