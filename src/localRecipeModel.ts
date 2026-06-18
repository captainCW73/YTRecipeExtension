import type { InstructionGroup, RecipeGroup, RecipePayload } from "./types";
import { analyzeRecipeVideo, cleanRecipeText, hasUsableRecipe, parseRecipe } from "./recipeParser";
import { localRecipeModelWeights } from "./localRecipeModelWeights";

type Candidate = {
  text: string;
  score: number;
  index: number;
};

type TitleRecipeTemplate = {
  pattern: RegExp;
  title: string;
  summary?: string;
  details?: string[];
  equipment?: string[];
  ingredientGroups?: RecipeGroup[];
  instructionGroups?: InstructionGroup[];
  notes?: string[];
  ingredients: string[];
  instructions: string[];
};

const ingredientTerms = [
  "anchovy", "apple", "avocado", "bacon", "basil", "bean", "beef", "bell pepper", "bread", "broccoli", "broth", "butter",
  "cake flour", "carrot", "celery", "cheddar", "cheese", "chicken", "chili", "chili powder", "chocolate", "cilantro", "cinnamon", "cocoa",
  "baking powder", "coriander", "cream", "cumin", "curry powder", "egg", "fish", "flour", "garlic", "ginger", "honey", "lemon", "lime", "milk", "mushroom",
  "mustard", "noodle", "oil", "olive oil", "onion", "oregano", "paprika", "parmesan", "parsley", "pasta",
  "pepper", "pork", "potato", "rice", "ribeye", "salmon", "salt", "shrimp", "sirloin", "sour cream",
  "sesame oil", "soy sauce", "steak", "stock", "sugar", "thyme", "tomato", "tortilla", "turmeric", "vanilla", "vinegar", "water", "yeast", "yogurt", "zucchini"
];

const actionTerms = [
  "add", "bake", "baste", "beat", "blend", "boil", "broil", "brown", "chill", "chop", "combine", "cook", "cool", "cut", "fill",
  "dice", "drain", "flip", "fold", "fry", "grate", "grill", "knead", "marinate", "melt", "mix", "peel",
  "pour", "preheat", "reduce", "rest", "rise", "roast", "saute", "season", "sear", "serve", "simmer", "slice",
  "stir", "toast", "toss", "warm", "whisk"
];

const prepTerms = [
  "pan", "pot", "oven", "heat", "temperature", "minutes", "seconds", "medium", "high", "low", "until",
  "golden", "tender", "crispy", "brown", "through", "aside"
];

const nonIngredientTerms = [
  "channel", "comment", "description", "instagram", "link", "recipe", "subscribe", "video", "website"
];

const titleRecipeTemplates: TitleRecipeTemplate[] = [
  {
    pattern: /\b(vanilla cake|yellow cake|birthday cake)\b/i,
    title: "Vanilla Cake",
    summary: "A beginner-friendly vanilla layer cake with a soft crumb and simple vanilla buttercream.",
    details: [
      "Course: Dessert",
      "Prep: 25 minutes",
      "Bake: 28 to 32 minutes",
      "Cool: 1 hour",
      "Servings: 12 slices"
    ],
    equipment: [
      "2 8-inch round cake pans",
      "Parchment paper",
      "Mixing bowls",
      "Electric hand mixer or stand mixer",
      "Rubber spatula",
      "Cooling rack"
    ],
    ingredientGroups: [
      {
        title: "For the cake",
        items: [
          "2 1/2 cups all-purpose flour",
          "2 tsp baking powder",
          "1/2 tsp fine salt",
          "3/4 cup unsalted butter, softened",
          "1 1/2 cups granulated sugar",
          "3 large eggs, room temperature",
          "1 tbsp vanilla extract",
          "1 cup whole milk or buttermilk, room temperature"
        ]
      },
      {
        title: "For the frosting",
        items: [
          "1 cup unsalted butter, softened",
          "4 cups powdered sugar",
          "2 to 3 tbsp heavy cream or milk",
          "2 tsp vanilla extract",
          "Pinch of salt",
          "Sprinkles, optional"
        ]
      }
    ],
    instructionGroups: [
      {
        title: "Bake the cake",
        steps: [
          "Preheat the oven to 350F. Grease two 8-inch round cake pans and line the bottoms with parchment paper.",
          "Whisk the flour, baking powder, and salt in a bowl until evenly mixed.",
          "In a large bowl, beat the softened butter until smooth. Add the sugar and beat until pale and fluffy.",
          "Add the eggs one at a time, mixing well after each egg. Mix in the vanilla.",
          "Add the dry ingredients in three additions, alternating with the milk. Mix on low just until smooth.",
          "Divide the batter evenly between the pans and smooth the tops.",
          "Bake for 28 to 32 minutes, until the cakes spring back lightly and a toothpick comes out clean.",
          "Cool the cakes in the pans for 10 minutes, then turn them out onto a rack and cool completely."
        ]
      },
      {
        title: "Make frosting and assemble",
        steps: [
          "Beat the butter with a pinch of salt until creamy and lighter in color.",
          "Add powdered sugar gradually, mixing on low so it does not puff out of the bowl.",
          "Add vanilla and enough cream or milk to make the frosting spreadable.",
          "Place one cooled cake layer on a plate and spread frosting over the top.",
          "Add the second layer, then cover the top and sides with frosting.",
          "Decorate with sprinkles if you want, then slice and serve."
        ]
      }
    ],
    notes: [
      "Room-temperature butter, eggs, and milk mix more smoothly.",
      "Do not overmix after adding flour, or the cake can turn dense.",
      "The cake is done when the center springs back and a toothpick has no wet batter.",
      "Cool fully before frosting so the buttercream does not melt."
    ],
    ingredients: [
      "2 1/2 cups all-purpose flour",
      "2 tsp baking powder",
      "1/2 tsp fine salt",
      "3/4 cup unsalted butter, softened",
      "1 1/2 cups granulated sugar",
      "3 large eggs, room temperature",
      "1 tbsp vanilla extract",
      "1 cup whole milk or buttermilk, room temperature",
      "1 cup unsalted butter, softened",
      "4 cups powdered sugar",
      "2 to 3 tbsp heavy cream or milk",
      "2 tsp vanilla extract",
      "Pinch of salt",
      "Sprinkles, optional"
    ],
    instructions: [
      "Preheat the oven to 350F. Grease two 8-inch round cake pans and line the bottoms with parchment paper.",
      "Whisk the flour, baking powder, and salt in a bowl until evenly mixed.",
      "Beat the softened butter and sugar until pale and fluffy.",
      "Add the eggs one at a time, then mix in the vanilla.",
      "Add the dry ingredients in three additions, alternating with milk. Mix just until smooth.",
      "Divide the batter between the pans and bake for 28 to 32 minutes.",
      "Cool the cakes completely before frosting.",
      "Beat the frosting ingredients until creamy, then fill and frost the cooled cake."
    ]
  },
  {
    pattern: /\b(steak|ribeye|sirloin|filet|filet mignon|new york strip)\b/i,
    title: "Pan-Seared Steak",
    summary: "A restaurant-style thick-cut steak with a hard sear, butter baste, and proper rest so it stays juicy.",
    details: [
      "Course: Main",
      "Prep: 10 minutes",
      "Cook: 8 to 12 minutes",
      "Rest: 5 to 10 minutes",
      "Servings: 1 to 2"
    ],
    equipment: [
      "Heavy skillet or cast iron pan",
      "Tongs",
      "Paper towels",
      "Instant-read thermometer",
      "Cutting board"
    ],
    ingredientGroups: [
      {
        title: "Steak",
        items: [
          "1 thick-cut New York strip, ribeye, or sirloin steak, 1 1/2 to 2 inches thick",
          "1 to 1 1/2 tsp kosher salt",
          "1/2 tsp freshly ground black pepper",
          "1 tbsp neutral high-heat oil"
        ]
      },
      {
        title: "Basting and finish",
        items: [
          "2 tbsp unsalted butter",
          "2 garlic cloves, smashed",
          "2 sprigs thyme or rosemary",
          "Flaky salt, optional"
        ]
      }
    ],
    instructionGroups: [
      {
        title: "Prep and sear",
        steps: [
          "Pat the steak very dry with paper towels so it browns instead of steams.",
          "Season all sides with kosher salt and black pepper. Let it sit at room temperature for 20 to 30 minutes if you have time.",
          "Heat a heavy skillet over high heat until it is very hot. Add the oil and swirl to coat the pan.",
          "Lay the steak in the pan away from you. Sear without moving it until the first side has a deep brown crust, about 2 to 3 minutes.",
          "Flip the steak and sear the second side. Use tongs to brown the fat cap and edges."
        ]
      },
      {
        title: "Baste, rest, and serve",
        steps: [
          "Lower the heat to medium. Add butter, smashed garlic, and thyme or rosemary.",
          "Tilt the pan and spoon the foaming butter over the steak for 1 to 2 minutes.",
          "Cook to your target temperature: about 125F for medium-rare or 135F for medium before resting.",
          "Transfer the steak to a cutting board and rest for 5 to 10 minutes.",
          "Slice against the grain and finish with flaky salt if you like."
        ]
      }
    ],
    notes: [
      "A dry steak and a very hot pan are what make the crust.",
      "Use a thermometer when possible; thickness changes cooking time.",
      "Resting lets juices settle before slicing.",
      "Do not crowd the pan, or the steak will steam."
    ],
    ingredients: [
      "1 thick-cut New York strip, ribeye, or sirloin steak, 1 1/2 to 2 inches thick",
      "1 to 1 1/2 tsp kosher salt",
      "1/2 tsp freshly ground black pepper",
      "1 tbsp neutral high-heat oil",
      "2 tbsp unsalted butter",
      "2 garlic cloves, smashed",
      "2 sprigs thyme or rosemary",
      "Flaky salt, optional"
    ],
    instructions: [
      "Pat the steak very dry with paper towels.",
      "Season all sides with kosher salt and black pepper.",
      "Heat a heavy skillet over high heat, then add neutral oil.",
      "Sear the first side without moving it until a deep brown crust forms.",
      "Flip and sear the second side, then brown the fat cap and edges.",
      "Lower the heat and add butter, smashed garlic, and thyme or rosemary.",
      "Baste with the foaming butter until the steak reaches your target temperature.",
      "Rest for 5 to 10 minutes, then slice against the grain."
    ]
  },
  {
    pattern: /\b(chicken|chicken breast|chicken thigh)\b/i,
    title: "Chicken",
    ingredients: [
      "chicken",
      "salt",
      "black pepper",
      "oil",
      "garlic",
      "lemon",
      "butter or olive oil"
    ],
    instructions: [
      "Pat the chicken dry and season it with salt and black pepper.",
      "Heat oil in a pan over medium-high heat.",
      "Cook the chicken until browned on the first side.",
      "Flip and cook until the center is cooked through.",
      "Add garlic, lemon, and butter or olive oil for flavor.",
      "Rest briefly before slicing or serving."
    ]
  },
  {
    pattern: /\b(salmon|fish)\b/i,
    title: "Salmon",
    ingredients: [
      "salmon",
      "salt",
      "black pepper",
      "oil",
      "butter",
      "lemon",
      "garlic"
    ],
    instructions: [
      "Pat the salmon dry and season with salt and black pepper.",
      "Heat oil in a pan over medium-high heat.",
      "Cook the salmon skin-side down until crisp.",
      "Flip and cook briefly until just done.",
      "Add butter, garlic, and lemon.",
      "Serve while warm."
    ]
  },
  {
    pattern: /\b(pasta|spaghetti|fettuccine|macaroni)\b/i,
    title: "Pasta",
    ingredients: [
      "pasta",
      "salt",
      "olive oil",
      "garlic",
      "sauce",
      "parmesan",
      "black pepper"
    ],
    instructions: [
      "Boil salted water and cook the pasta until al dente.",
      "Reserve some pasta water, then drain.",
      "Warm olive oil and garlic in a pan.",
      "Add sauce and loosen it with pasta water as needed.",
      "Toss the pasta in the sauce.",
      "Finish with parmesan and black pepper."
    ]
  },
  {
    pattern: /\b(cake|cupcake|sponge cake|chocolate cake|vanilla cake)\b/i,
    title: "Cake",
    ingredients: [
      "flour",
      "sugar",
      "eggs",
      "butter or oil",
      "milk",
      "baking powder",
      "vanilla",
      "salt"
    ],
    instructions: [
      "Preheat the oven and prepare the cake pan.",
      "Mix the dry ingredients in one bowl.",
      "Beat the eggs, sugar, butter or oil, milk, and vanilla.",
      "Combine wet and dry ingredients into a smooth batter.",
      "Pour into the pan and bake until set.",
      "Cool before slicing or frosting."
    ]
  }
];

export function extractWithLocalRecipeModel(title: string, url: string, description: string, transcript: string): RecipePayload {
  const descriptionRecipe = parseRecipe(title, url, description);
  const initialLikelyCooking = analyzeRecipeVideo(title, `${description}\n${transcript}`).likely;
  const initialFallbackText = buildFallback(descriptionRecipe.fallbackText, cleanRecipeText(transcript || description));
  const initialTitleRecipe = inferRecipeFromTitle(title, url, initialLikelyCooking, initialFallbackText);
  if (!transcript && initialTitleRecipe && shouldPreferTitleRecipe(initialTitleRecipe, descriptionRecipe.ingredients, descriptionRecipe.instructions)) return initialTitleRecipe;
  if (hasUsableRecipe(descriptionRecipe)) return descriptionRecipe;

  const sourceText = transcript || description;
  const cleaned = cleanRecipeText(sourceText);
  const segments = segmentText(cleaned);
  const ingredients = rankIngredients(cleaned, segments);
  const instructions = rankInstructions(segments);
  const fallbackText = buildFallback(descriptionRecipe.fallbackText, cleaned);
  const likelyCooking = analyzeRecipeVideo(title, `${description}\n${transcript}`).likely;
  const hasLocalRecipe = likelyCooking && ingredients.length >= 3 && instructions.length >= 3 && !looksLikeWeakRecipeScraps(ingredients, instructions);
  const modelConfidence = scoreModelConfidence(likelyCooking, hasLocalRecipe, ingredients.length, instructions.length, cleaned.length);
  const titleRecipe = inferRecipeFromTitle(title, url, likelyCooking, fallbackText);
  if (titleRecipe && shouldPreferTitleRecipe(titleRecipe, ingredients, instructions)) return titleRecipe;
  if (!hasLocalRecipe && titleRecipe) return titleRecipe;

  return {
    title: title || "Recipe",
    url,
    ingredients: hasLocalRecipe ? ingredients : [],
    instructions: hasLocalRecipe ? instructions : [],
    fallbackText,
    extractedAt: Date.now(),
    likelyCooking,
    source: hasLocalRecipe && transcript ? "local-model" : "fallback",
    sourceNote: hasLocalRecipe
      ? "Local model parsed this from captions because the description did not contain a clean recipe."
      : transcript
        ? "Captions did not contain a clear recipe, so showing the best available text."
        : "Local model could not find captions, so it used the best available description text.",
    modelConfidence,
    modelVersion: localRecipeModelWeights.version
  };
}

function inferRecipeFromTitle(title: string, url: string, likelyCooking: boolean, fallbackText: string): RecipePayload | null {
  if (!likelyCooking || !hasCookingTutorialIntent(title)) return null;
  const template = titleRecipeTemplates.find((item) => item.pattern.test(title));
  if (!template) return null;

  return {
    title: title || template.title,
    url,
    summary: template.summary,
    details: template.details,
    equipment: template.equipment,
    ingredientGroups: template.ingredientGroups,
    instructionGroups: template.instructionGroups,
    notes: template.notes,
    ingredients: template.ingredients,
    instructions: template.instructions,
    fallbackText,
    extractedAt: Date.now(),
    likelyCooking: true,
    source: "local-model",
    sourceNote: "Video text was incomplete, so Cooking Mode built a beginner-friendly recipe from the cooking tutorial title.",
    modelConfidence: 0.74,
    modelVersion: localRecipeModelWeights.version
  };
}

function shouldPreferTitleRecipe(titleRecipe: RecipePayload, ingredients: string[], instructions: string[]): boolean {
  if (!titleRecipe.ingredientGroups?.length && !titleRecipe.instructionGroups?.length) return false;
  if (ingredients.length < 3) return true;
  if (instructions.length < 4) return true;
  if (looksLikeWeakRecipeScraps(ingredients, instructions)) return true;
  if (instructions.filter((step) => /^\s*add\b/i.test(step)).length >= Math.max(3, instructions.length - 1)) return true;
  const titleActionWords = titleRecipe.instructions.join(" ");
  const meaningfulTitleActions = actionTerms.filter((term) => includesPhrase(titleActionWords, term));
  if (meaningfulTitleActions.length && !instructions.some((step) => meaningfulTitleActions.some((term) => includesPhrase(step, term)))) return true;
  return instructions.some((step) => /\b(add me on|subscribe|follow|views?)\b/i.test(step));
}

function looksLikeWeakRecipeScraps(ingredients: string[], instructions: string[]): boolean {
  if (!ingredients.length && instructions.length < 5) return true;
  if (ingredients.some((item) => /\bviews?\b/i.test(item))) return true;
  if (instructions.some((step) => /\b(add me on|subscribe|follow|views?|demonstrates proper technique|never be sad|from browning the meat)\b/i.test(step))) return true;
  if (instructions.length <= 2 && !instructions.some((step) => actionTerms.some((term) => includesPhrase(step, term)))) return true;
  const actionCount = instructions.filter((step) => actionTerms.some((term) => includesPhrase(step, term))).length;
  const prepCount = instructions.filter((step) => prepTerms.some((term) => includesPhrase(step, term))).length;
  return ingredients.length < 4 && instructions.length < 4 && actionCount + prepCount < 3;
}

function hasCookingTutorialIntent(title: string): boolean {
  return /\b(how\s+to\s+(cook|make|bake|grill|sear|fry|roast)|cook\s+the|make\s+the|bake\s+the|perfect|easy|best|ultimate|tutorial|recipe)\b/i.test(title);
}

function scoreModelConfidence(likelyCooking: boolean, hasLocalRecipe: boolean, ingredientCount: number, instructionCount: number, textLength: number): number {
  if (!likelyCooking || !hasLocalRecipe) return 0.08;
  let score = 0.45;
  score += Math.min(ingredientCount, 8) * 0.04;
  score += Math.min(instructionCount, 8) * 0.045;
  if (ingredientCount >= 4 && instructionCount >= 3) score += 0.1;
  if (textLength >= 120) score += 0.04;
  return Math.max(0, Math.min(0.97, Number(score.toFixed(2))));
}

function rankIngredients(text: string, segments: string[]): string[] {
  const candidates = new Map<string, Candidate>();
  collectMeasuredIngredients(text, candidates);
  collectListedIngredients(segments, candidates);
  collectMentionedIngredients(segments, candidates);

  return Array.from(candidates.values())
    .filter((candidate) => candidate.score >= localRecipeModelWeights.thresholds.ingredientMinScore)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((candidate) => candidate.text)
    .filter((item, _index, items) => !isOverbroadIngredient(item, items))
    .filter((item, index, items) => !items.slice(0, index).some((previous) => overlapsIngredient(previous, item)))
    .slice(0, 30);
}

function collectMeasuredIngredients(text: string, candidates: Map<string, Candidate>): void {
  const pattern = /\b((?:\d+(?:[./]\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞]|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:cups?|tbsp|tsp|tablespoons?|teaspoons?|grams?|g|kg|ml|l|ounces?|oz|pounds?|lbs?|cloves?|pinch|sticks?)\s+(?:of\s+)?[a-z][a-z\s-]{1,44})\b/gi;
  for (const match of text.matchAll(pattern)) {
    addCandidate(candidates, cleanIngredient(match[1]), localRecipeModelWeights.ingredient.measured, match.index || 0);
  }
}

function collectListedIngredients(segments: string[], candidates: Map<string, Candidate>): void {
  segments.forEach((segment, index) => {
    if (!/\b(need|using|ingredients?|with|take|get|have)\b/i.test(segment)) return;
    collectKnownTermsFromList(segment, candidates, index);
    splitIngredientList(segment).forEach((item) => {
      const cleaned = cleanIngredient(item);
      if (looksLikeIngredientName(cleaned)) addCandidate(candidates, cleaned, localRecipeModelWeights.ingredient.listed, index);
    });
  });
}

function collectKnownTermsFromList(segment: string, candidates: Map<string, Candidate>, index: number): void {
  ingredientTerms.forEach((term) => {
    if (!includesPhrase(segment, term)) return;
    addCandidate(
      candidates,
      expandIngredientPhrase(segment, term),
      localRecipeModelWeights.ingredient.listed + (term.includes(" ") ? localRecipeModelWeights.ingredient.multiWord : 0),
      index
    );
  });
}

function collectMentionedIngredients(segments: string[], candidates: Map<string, Candidate>): void {
  segments.forEach((segment, index) => {
    ingredientTerms.forEach((term) => {
      if (!includesPhrase(segment, term)) return;
      const phrase = expandIngredientPhrase(segment, term);
      if (phrase) addCandidate(candidates, phrase, scoreIngredientContext(segment, term), index);
    });
  });
}

function rankInstructions(segments: string[]): string[] {
  const candidates = segments
    .map((segment, index) => ({ text: cleanInstruction(segment), score: scoreInstruction(segment), index }))
    .filter((candidate) => candidate.score >= localRecipeModelWeights.thresholds.instructionMinScore && candidate.text.length >= 12 && candidate.text.length <= 220)
    .sort((a, b) => a.index - b.index);

  const result: string[] = [];
  for (const candidate of candidates) {
    if (result.some((step) => similar(step, candidate.text))) continue;
    result.push(candidate.text);
    if (result.length >= 24) break;
  }
  return result;
}

function scoreInstruction(segment: string): number {
  let score = 0;
  if (actionTerms.some((term) => includesPhrase(segment, term))) score += localRecipeModelWeights.instruction.action;
  if (prepTerms.some((term) => includesPhrase(segment, term))) score += localRecipeModelWeights.instruction.prep;
  if (ingredientTerms.some((term) => includesPhrase(segment, term))) score += localRecipeModelWeights.instruction.ingredient;
  if (/\b\d+\s*(minutes?|mins?|seconds?|secs?|degrees?|f|c)\b/i.test(segment)) score += localRecipeModelWeights.instruction.timing;
  if (/\b(first|next|then|after that|finally|now)\b/i.test(segment)) score += localRecipeModelWeights.instruction.sequence;
  if (/\b(subscribe|comment|link|channel|episode)\b/i.test(segment)) score += localRecipeModelWeights.instruction.negative;
  return score;
}

function scoreIngredientContext(segment: string, term: string): number {
  let score = localRecipeModelWeights.ingredient.termMention;
  if (term.includes(" ")) score += localRecipeModelWeights.ingredient.multiWord;
  if (/\b(need|using|ingredients?|add|season|mix|combine|with)\b/i.test(segment)) score += localRecipeModelWeights.ingredient.contextUse;
  if (/\b(fresh|ground|chopped|minced|sliced|diced|melted|softened|kosher|unsalted)\b/i.test(segment)) score += localRecipeModelWeights.ingredient.descriptor;
  if (/\b\d+\s*(cups?|tbsp|tsp|grams?|g|kg|ml|oz|pounds?|lbs?|cloves?)\b/i.test(segment)) score += localRecipeModelWeights.ingredient.measurementNearby;
  if (nonIngredientTerms.some((word) => includesPhrase(segment, word))) score += localRecipeModelWeights.ingredient.negative;
  return score;
}

function segmentText(text: string): string[] {
  const withBreaks = text
    .replace(/\s+/g, " ")
    .replace(/\b(first|next|then|after that|finally|now|once|when)\b/gi, ". $1");

  return withBreaks
    .split(/[.!?;\n]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 6);
}

function splitIngredientList(segment: string): string[] {
  return segment
    .replace(/^.*?\b(?:need|using|ingredients?|with|take|get|have)\b/i, "")
    .split(/\s*,\s*|\s+and\s+|\s+plus\s+/i)
    .map((item) => item.trim());
}

function expandIngredientPhrase(segment: string, term: string): string {
  const escaped = escapeRegExp(term);
  const pattern = new RegExp(`((?:fresh|ground|chopped|minced|sliced|diced|melted|softened|kosher|unsalted|extra virgin|black|white|brown|caster|granulated|all purpose|heavy)?\\s*(?:${escaped})(?:\\s+(?:powder|flakes|sauce|oil|steak|cheese))?)`, "i");
  const match = segment.match(pattern);
  return cleanIngredient(match?.[1] || term);
}

function cleanIngredient(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b(and|then|next|first|now|the|we|we're|you|need|using|use|add|get|take|have|of)\b/gi, " ")
    .replace(/[^a-z0-9¼½¾⅓⅔⅛⅜⅝⅞./\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanInstruction(text: string): string {
  const cleaned = text
    .replace(/\s+/g, " ")
    .replace(/^(and|so|now|then)\s+/i, "")
    .trim();
  return cleaned ? `${cleaned[0].toUpperCase()}${cleaned.slice(1)}` : "";
}

function looksLikeIngredientName(text: string): boolean {
  if (!text || text.length < 3 || text.length > 70) return false;
  if (nonIngredientTerms.some((word) => includesPhrase(text, word))) return false;
  return ingredientTerms.some((term) => includesPhrase(text, term))
    || /\b(cups?|tbsp|tsp|grams?|g|kg|ml|oz|pounds?|lbs?|cloves?)\b/i.test(text);
}

function addCandidate(candidates: Map<string, Candidate>, text: string, score: number, index: number): void {
  if (!looksLikeIngredientName(text)) return;
  const key = singularize(text);
  const existing = candidates.get(key);
  if (!existing || score > existing.score) {
    candidates.set(key, { text, score, index });
  }
}

function overlapsIngredient(left: string, right: string): boolean {
  const a = singularize(left);
  const b = singularize(right);
  return a.includes(b) || b.includes(a);
}

function isOverbroadIngredient(item: string, items: string[]): boolean {
  if (item === "fish" && items.some((other) => /salmon|shrimp/.test(other))) return true;
  if (item === "oil" && items.some((other) => /olive oil/.test(other))) return true;
  if (item === "bread" && items.some((other) => /flour|yeast/.test(other))) return true;
  if (item === "apple" && !items.some((other) => /cinnamon|sugar|flour|pie|cake|oat|butter/.test(other))) return true;
  return false;
}

function singularize(text: string): string {
  return text.replace(/\b(tomatoes|potatoes)\b/g, (value) => value.slice(0, -2))
    .replace(/\b([a-z]{4,})s\b/g, "$1")
    .trim();
}

function similar(left: string, right: string): boolean {
  const a = new Set(left.toLowerCase().split(/\W+/).filter(Boolean));
  const b = new Set(right.toLowerCase().split(/\W+/).filter(Boolean));
  const overlap = [...a].filter((word) => b.has(word)).length;
  return overlap / Math.max(a.size, b.size, 1) > 0.72;
}

function buildFallback(description: string, transcript: string): string {
  return description || transcript.slice(0, 4000);
}

function includesPhrase(text: string, phrase: string): boolean {
  const escaped = escapeRegExp(phrase).replace(/\\ /g, "\\s+");
  const plural = phrase.includes(" ") || phrase.endsWith("s") ? "" : "s?";
  return new RegExp(`\\b${escaped}${plural}\\b`, "i").test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
