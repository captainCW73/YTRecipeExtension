import type { StoredCookingMode } from "./types";

const statusNode = byId<HTMLElement>("status");
const loadButton = byId<HTMLButtonElement>("load-sample");

loadButton.addEventListener("click", async () => {
  const sample: StoredCookingMode = {
    wakeLockActive: false,
    recipe: {
      title: "Self Test Chocolate Cake",
      url: "https://www.youtube.com/watch?v=self-test",
      ingredients: ["2 cups flour", "1 cup sugar", "3 eggs", "1 cup milk", "1 tsp vanilla"],
      instructions: ["Preheat oven to 350F.", "Whisk wet ingredients.", "Fold in dry ingredients.", "Bake for 30 minutes.", "Cool before frosting."],
      fallbackText: "",
      extractedAt: Date.now(),
      likelyCooking: true
    }
  };

  await chrome.storage.session.set({ cookingMode: sample });
  statusNode.textContent = "Sample loaded.";
  await chrome.tabs.create({ url: chrome.runtime.getURL("cooking.html") });
});

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}
