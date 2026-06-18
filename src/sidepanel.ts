import type { AgentSettings, RecipePayload, RuntimeMessage, StoredCookingMode, WakeLockMode } from "./types";

const storageKey = "cookingMode";
const settingsKey = "cookingModeAgentSettings";

const empty = byId<HTMLElement>("empty");
const recipeNode = byId<HTMLElement>("recipe");
const title = byId<HTMLElement>("recipe-title");
const source = byId<HTMLAnchorElement>("source-link");
const overviewSection = byId<HTMLElement>("overview-section");
const recipeSummary = byId<HTMLElement>("recipe-summary");
const recipeDetails = byId<HTMLElement>("recipe-details");
const equipmentSection = byId<HTMLElement>("equipment-section");
const equipment = byId<HTMLUListElement>("equipment");
const ingredientGroups = byId<HTMLElement>("ingredient-groups");
const instructionGroups = byId<HTMLElement>("instruction-groups");
const notesSection = byId<HTMLElement>("notes-section");
const notes = byId<HTMLUListElement>("notes");
const ingredients = byId<HTMLUListElement>("ingredients");
const instructions = byId<HTMLOListElement>("instructions");
const fallback = byId<HTMLElement>("fallback");
const recipeCounts = byId<HTMLElement>("recipe-counts");
const recipeNote = byId<HTMLElement>("recipe-note");
const fallbackSection = byId<HTMLElement>("fallback-section");
const ingredientsSection = byId<HTMLElement>("ingredients-section");
const instructionsSection = byId<HTMLElement>("instructions-section");
const wakeStatus = byId<HTMLElement>("wake-status");
const copyButton = byId<HTMLButtonElement>("copy-button");
const endButton = byId<HTMLButtonElement>("end-button");
const wakeMode = byId<HTMLSelectElement>("wake-mode");
const agentEnabled = byId<HTMLInputElement>("agent-enabled");
const provider = byId<HTMLSelectElement>("provider");
const backendUrl = byId<HTMLInputElement>("backend-url");
const ollamaUrl = byId<HTMLInputElement>("ollama-url");
const apiKey = byId<HTMLInputElement>("api-key");
const apiBaseUrl = byId<HTMLInputElement>("api-base-url");
const model = byId<HTMLInputElement>("model");
const saveAgentSettings = byId<HTMLButtonElement>("save-agent-settings");

let currentRecipe: RecipePayload | undefined;

if (hasChromeRuntime()) {
  loadAgentSettings();
  chrome.storage.session.get(storageKey, ({ cookingMode }: { cookingMode?: StoredCookingMode }) => {
    render(cookingMode);
    if (!cookingMode?.recipe) requestRecipeFromActiveTab();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "session") return;
    const change = changes[storageKey];
    if (change) render(change.newValue as StoredCookingMode | undefined);
  });
} else {
  render({
    wakeLockActive: true,
    recipe: {
      title: "Chocolate Cake",
      url: "https://www.youtube.com/watch?v=demo",
      ingredients: ["2 cups flour", "1 cup sugar", "3 eggs", "1 cup milk", "1 tsp vanilla"],
      instructions: ["Preheat oven to 350F.", "Mix dry ingredients.", "Whisk wet ingredients.", "Combine batter.", "Bake for 30 minutes."],
      fallbackText: "",
      extractedAt: Date.now(),
      likelyCooking: true,
      source: "description"
    }
  });
}

copyButton.addEventListener("click", async () => {
  if (!currentRecipe) return;
  await navigator.clipboard.writeText(formatRecipe(currentRecipe));
  copyButton.textContent = "Copied";
  window.setTimeout(() => {
    copyButton.textContent = "Copy";
  }, 1200);
});

endButton.addEventListener("click", () => {
  const message: RuntimeMessage = { type: "END_COOKING_MODE" };
  if (hasChromeRuntime()) chrome.runtime.sendMessage(message);
  wakeStatus.textContent = "Off";
  wakeStatus.classList.add("off");
});

wakeMode.addEventListener("change", () => {
  const message: RuntimeMessage = { type: "SET_WAKE_LOCK_MODE", mode: wakeMode.value as WakeLockMode };
  if (hasChromeRuntime()) chrome.runtime.sendMessage(message).catch(() => undefined);
});

saveAgentSettings.addEventListener("click", async () => {
  const settings: AgentSettings = {
    enabled: agentEnabled.checked,
    provider: provider.value as AgentSettings["provider"],
    backendUrl: backendUrl.value.trim() || "http://127.0.0.1:8787",
    ollamaUrl: ollamaUrl.value.trim() || "http://127.0.0.1:11434",
    apiKey: apiKey.value.trim() || undefined,
    apiBaseUrl: apiBaseUrl.value.trim() || undefined,
    model: model.value.trim() || defaultModel(provider.value)
  };
  await chrome.storage.local.set({ [settingsKey]: settings });
  saveAgentSettings.textContent = "Saved";
  window.setTimeout(() => {
    saveAgentSettings.textContent = "Save Settings";
  }, 1100);
});

window.addEventListener("beforeunload", () => {
  const message: RuntimeMessage = { type: "END_COOKING_MODE" };
  if (hasChromeRuntime()) chrome.runtime.sendMessage(message).catch(() => undefined);
});

async function requestRecipeFromActiveTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:\/\/([^/]+\.)?youtube\.com\//.test(tab.url)) return;
  const message: RuntimeMessage = { type: "OPEN_FROM_POPUP", tabId: tab.id };
  const result = await chrome.runtime.sendMessage(message).catch(() => undefined);
  if (result?.recipe) {
    render({ recipe: result.recipe, tabId: tab.id, wakeLockActive: Boolean(result.wakeLockActive) });
  }
}

async function loadAgentSettings(): Promise<void> {
  const state = await chrome.storage.local.get(settingsKey) as { cookingModeAgentSettings?: AgentSettings };
  const settings = state.cookingModeAgentSettings || {
    enabled: true,
    provider: "ollama",
    backendUrl: "http://127.0.0.1:8787",
    ollamaUrl: "http://127.0.0.1:11434",
    model: "llama3.2:3b"
  };
  agentEnabled.checked = settings.enabled;
  provider.value = settings.provider || "ollama";
  backendUrl.value = settings.backendUrl || "http://127.0.0.1:8787";
  ollamaUrl.value = settings.ollamaUrl || "http://127.0.0.1:11434";
  apiKey.value = settings.apiKey || "";
  apiBaseUrl.value = settings.apiBaseUrl || "";
  model.value = settings.model || defaultModel(provider.value);
}

function defaultModel(value: string): string {
  if (value === "openai") return "gpt-4o-mini";
  if (value === "groq") return "llama-3.1-8b-instant";
  if (value === "deepseek") return "deepseek-chat";
  if (value === "gemini") return "gemini-1.5-flash";
  if (value === "claude") return "claude-3-5-haiku-latest";
  return "llama3.2:3b";
}

function render(state?: StoredCookingMode): void {
  currentRecipe = state?.recipe;
  const hasRecipe = Boolean(currentRecipe);
  empty.hidden = hasRecipe;
  recipeNode.hidden = !hasRecipe;
  copyButton.disabled = !hasRecipe;
  endButton.disabled = !hasRecipe;
  renderWakeStatus(Boolean(hasRecipe && state?.wakeLockActive));
  wakeMode.value = state?.wakeLockMode || "video";

  if (!currentRecipe) return;

  title.textContent = capitalizeDisplayText(currentRecipe.title);
  source.href = currentRecipe.url;
  recipeCounts.textContent = formatCounts(currentRecipe);
  recipeNote.textContent = formatNote(currentRecipe);
  recipeSummary.textContent = currentRecipe.summary ? capitalizeDisplayText(currentRecipe.summary) : "";
  renderDetails(recipeDetails, currentRecipe.details || []);
  renderList(equipment, currentRecipe.equipment || []);
  renderIngredientGroups(ingredientGroups, currentRecipe.ingredientGroups || []);
  renderInstructionGroups(instructionGroups, currentRecipe.instructionGroups || []);
  renderList(notes, currentRecipe.notes || []);
  renderList(ingredients, currentRecipe.ingredients);
  renderList(instructions, displayInstructions(currentRecipe));
  overviewSection.hidden = !currentRecipe.summary && !currentRecipe.details?.length;
  equipmentSection.hidden = !currentRecipe.equipment?.length;
  notesSection.hidden = !currentRecipe.notes?.length;
  ingredients.hidden = Boolean(currentRecipe.ingredientGroups?.length);
  instructions.hidden = Boolean(currentRecipe.instructionGroups?.length);
  ingredientsSection.hidden = currentRecipe.ingredients.length === 0 && !currentRecipe.ingredientGroups?.length;
  instructionsSection.hidden = false;
  fallback.textContent = currentRecipe.fallbackText;
  fallbackSection.hidden = currentRecipe.ingredients.length > 0 || currentRecipe.instructions.length > 0;
}

function renderWakeStatus(active: boolean): void {
  wakeStatus.textContent = active ? "Awake" : "Off";
  wakeStatus.classList.toggle("off", !active);
}

function renderList(node: HTMLElement, items: string[]): void {
  node.replaceChildren(...items.map((item) => {
    const li = document.createElement("li");
    li.textContent = capitalizeDisplayText(item);
    return li;
  }));
}

function renderDetails(node: HTMLElement, items: string[]): void {
  node.replaceChildren(...items.map((item) => {
    const detail = document.createElement("span");
    detail.textContent = capitalizeDisplayText(item);
    return detail;
  }));
}

function renderIngredientGroups(node: HTMLElement, groups: NonNullable<RecipePayload["ingredientGroups"]>): void {
  node.replaceChildren(...groups.map((group) => {
    const section = document.createElement("section");
    section.className = "subgroup";
    const heading = document.createElement("h4");
    heading.textContent = capitalizeDisplayText(group.title);
    const list = document.createElement("ul");
    renderList(list, group.items);
    section.append(heading, list);
    return section;
  }));
}

function renderInstructionGroups(node: HTMLElement, groups: NonNullable<RecipePayload["instructionGroups"]>): void {
  node.replaceChildren(...groups.map((group) => {
    const section = document.createElement("section");
    section.className = "subgroup";
    const heading = document.createElement("h4");
    heading.textContent = capitalizeDisplayText(group.title);
    const list = document.createElement("ol");
    renderList(list, group.steps);
    section.append(heading, list);
    return section;
  }));
}

function formatRecipe(recipe: RecipePayload): string {
  const parts = [recipe.title, recipe.url, ""];
  parts.push(`Source: ${formatSource(recipe)}`, "");
  if (recipe.summary) parts.push(recipe.summary, "");
  if (recipe.details?.length) parts.push("Details", ...recipe.details.map((item) => `- ${item}`), "");
  if (recipe.equipment?.length) parts.push("Equipment", ...recipe.equipment.map((item) => `- ${item}`), "");
  if (recipe.modelConfidence !== undefined) parts.push(`Confidence: ${formatConfidence(recipe.modelConfidence)}`, "");
  if (recipe.ingredientGroups?.length) {
    parts.push("Ingredients");
    recipe.ingredientGroups.forEach((group) => parts.push(group.title, ...group.items.map((item) => `- ${item}`)));
    parts.push("");
  } else if (recipe.ingredients.length) {
    parts.push("Ingredients", ...recipe.ingredients.map((item) => `- ${item}`), "");
  }
  if (recipe.instructionGroups?.length) {
    parts.push("Instructions");
    recipe.instructionGroups.forEach((group) => parts.push(capitalizeDisplayText(group.title), ...group.steps.map((item, index) => `${index + 1}. ${capitalizeDisplayText(item)}`)));
    parts.push("");
  } else if (recipe.instructions.length) {
    parts.push("Instructions", ...recipe.instructions.map((item, index) => `${index + 1}. ${capitalizeDisplayText(item)}`), "");
  } else {
    parts.push("Instructions", ...displayInstructions(recipe).map((item, index) => `${index + 1}. ${capitalizeDisplayText(item)}`), "");
  }
  if (recipe.notes?.length) parts.push("Notes", ...recipe.notes.map((item) => `- ${item}`), "");
  if (!recipe.ingredients.length && !recipe.instructions.length) parts.push(recipe.fallbackText);
  return parts.join("\n");
}

function formatCounts(recipe: RecipePayload): string {
  const parts = [];
  if (recipe.ingredients.length) parts.push(`${recipe.ingredients.length} Ingredients`);
  if (recipe.instructions.length) parts.push(`${recipe.instructions.length} Steps`);
  if (!parts.length) parts.push("Description Fallback");
  parts.push(formatSource(recipe));
  if (recipe.modelConfidence !== undefined && recipe.source === "local-model") parts.push(formatConfidence(recipe.modelConfidence));
  parts.push(recipe.likelyCooking ? "Recipe Likely" : "Manual Scan");
  return parts.join(" · ");
}

function formatNote(recipe: RecipePayload): string {
  if (recipe.sourceNote) return recipe.sourceNote;
  if (recipe.source === "local-model") {
    return "Local model parsed this from captions because the description did not contain a clean recipe.";
  }
  if (recipe.ingredients.length && recipe.instructions.length) {
    return "Recipe pulled from the video description.";
  }
  if (recipe.ingredients.length) {
    return "Found ingredients. Instructions may be in the video or hidden description text.";
  }
  if (recipe.instructions.length) {
    return "Found cooking steps. Ingredients may be missing or mixed into the description.";
  }
  if (recipe.fallbackText) {
    return "No clean recipe sections found, so the cleaned description is shown.";
  }
  return "No description text found yet. Try expanding the video description, then press Cooking Mode again.";
}

function formatSource(recipe: RecipePayload): string {
  if (recipe.source === "local-model") return "Local model";
  if (recipe.source === "fallback") return "Fallback";
  return "Description";
}

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}% Confidence`;
}

function displayInstructions(recipe: RecipePayload): string[] {
  if (recipe.instructions.length) return recipe.instructions;
  if (recipe.instructionGroups?.length) return [];
  if (recipe.ingredients.length) return ["No verified step-by-step instructions found in this video's description or captions."];
  return ["Open a cooking video and press Cook to extract verified instructions."];
}

function capitalizeDisplayText(value: string): string {
  const trimmed = value.trim();
  const index = trimmed.search(/[a-z]/i);
  if (index === -1) return trimmed;
  return `${trimmed.slice(0, index)}${trimmed[index].toUpperCase()}${trimmed.slice(index + 1)}`;
}

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

function hasChromeRuntime(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
}
