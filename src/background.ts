import type { ActionResult, AgentExtractRequest, AgentSettings, RecipePayload, RuntimeMessage, StoredCookingMode } from "./types";

const storageKey = "cookingMode";
const settingsKey = "cookingModeAgentSettings";
const contextMenuId = "cooking-mode-open";
const defaultAgentSettings: AgentSettings = {
  enabled: true,
  backendUrl: "http://127.0.0.1:8787",
  provider: "ollama",
  model: "llama3.2:3b",
  ollamaUrl: "http://127.0.0.1:11434"
};

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

void ensureContextMenu();
chrome.runtime.onInstalled.addListener(() => void ensureContextMenu());

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== contextMenuId || !tab?.id) return;
  void openFromTab(tab.id);
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  if (message.type === "OPEN_PANEL_FROM_CONTENT" && sender.tab?.id) {
    chrome.sidePanel.open({ tabId: sender.tab.id }).then(() => sendResponse({ ok: true })).catch((error) => {
      sendResponse({ ok: false, error: getErrorMessage(error) });
    });
    return true;
  }

  if (message.type === "OPEN_FROM_CONTENT" && sender.tab?.id) {
    void chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => undefined);
    openFromTab(sender.tab.id).then(sendResponse);
    return true;
  }

  if (message.type === "OPEN_FROM_POPUP") {
    openFromTab(message.tabId).then(sendResponse);
    return true;
  }

  if (message.type === "CONTENT_SCRIPT_READY" && sender.tab?.id) {
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: "ON" });
    chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: "#d9471f" });
    return;
  }

  if (message.type === "SHOW_BUTTON_FROM_POPUP") {
    showButtonInTab(message.tabId).then(sendResponse);
    return true;
  }

  if (message.type === "OPEN_COOKING_MODE" && sender.tab?.id) {
    storeCookingMode(sender.tab.id, message.recipe, message.wakeLockActive)
      .then(() => chrome.sidePanel.open({ tabId: sender.tab!.id! }).catch(() => undefined))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));
    return true;
  }

  if (message.type === "EXTRACT_WITH_AGENT") {
    extractWithAgent(message.request).then((recipe) => {
      sendResponse(recipe ? { ok: true, recipe } : { ok: false, error: "agent unavailable" });
    }).catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));
    return true;
  }

  if (message.type === "WAKE_LOCK_CHANGED") {
    chrome.storage.session.get(storageKey, ({ cookingMode }: { cookingMode?: StoredCookingMode }) => {
      if (!cookingMode?.recipe) return;
      chrome.storage.session.set({
        [storageKey]: { ...cookingMode, wakeLockActive: message.wakeLockActive }
      });
    });
    return;
  }

  if (message.type === "SET_WAKE_LOCK_MODE") {
    chrome.storage.session.get(storageKey, ({ cookingMode }: { cookingMode?: StoredCookingMode }) => {
      const tabId = cookingMode?.tabId;
      if (tabId) chrome.tabs.sendMessage(tabId, message).catch(() => undefined);
      if (!cookingMode?.recipe) return;
      chrome.storage.session.set({
        [storageKey]: { ...cookingMode, wakeLockMode: message.mode }
      });
    });
    return;
  }

  if (message.type === "END_COOKING_MODE") {
    chrome.storage.session.get(storageKey, ({ cookingMode }: { cookingMode?: StoredCookingMode }) => {
      if (cookingMode?.tabId) chrome.tabs.sendMessage(cookingMode.tabId, message).catch(() => undefined);
      if (!cookingMode?.recipe) return;
      chrome.storage.session.set({
        [storageKey]: { ...cookingMode, wakeLockActive: false }
      });
    });
  }
});

async function openFromTab(tabId: number): Promise<ActionResult> {
  const message: RuntimeMessage = { type: "REQUEST_OPEN_COOKING_MODE" };
  const result = await sendWithInjection(tabId, message);
  if (result.ok && result.recipe) {
    await storeCookingMode(tabId, result.recipe, Boolean(result.wakeLockActive)).catch(() => undefined);
  }
  await chrome.sidePanel.open({ tabId }).catch(() => undefined);
  return result;
}

async function extractWithAgent(request: AgentExtractRequest): Promise<RecipePayload | undefined> {
  const settings = await getAgentSettings();
  if (!settings.enabled || !settings.backendUrl) return undefined;
  const response = await fetch(`${settings.backendUrl.replace(/\/+$/g, "")}/recipe-agent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      request,
      settings: {
        provider: settings.provider,
        apiKey: settings.apiKey,
        model: settings.model,
        ollamaUrl: settings.ollamaUrl,
        apiBaseUrl: settings.apiBaseUrl
      }
    })
  });
  if (!response.ok) return undefined;
  const data = await response.json() as { ok?: boolean; recipe?: RecipePayload };
  return data.ok ? data.recipe : undefined;
}

function getAgentSettings(): Promise<AgentSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get(settingsKey, ({ cookingModeAgentSettings }: { cookingModeAgentSettings?: AgentSettings }) => {
      resolve({ ...defaultAgentSettings, ...cookingModeAgentSettings });
    });
  });
}

async function showButtonInTab(tabId: number): Promise<ActionResult> {
  const message: RuntimeMessage = { type: "SHOW_COOKING_BUTTON" };
  return sendWithInjection(tabId, message);
}

async function sendWithInjection(tabId: number, message: RuntimeMessage): Promise<ActionResult> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, message) as ActionResult | undefined;
    return { ok: true, injected: false, ...extractRecipeResponse(response) };
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["contentScript.js"] });
      const response = await chrome.tabs.sendMessage(tabId, message) as ActionResult | undefined;
      return { ok: true, injected: true, ...extractRecipeResponse(response) };
    } catch (error) {
      return { ok: false, injected: false, error: getErrorMessage(error) };
    }
  }
}

function extractRecipeResponse(response?: ActionResult): Pick<ActionResult, "recipe" | "wakeLockActive" | "error"> {
  return {
    recipe: response?.recipe,
    wakeLockActive: response?.wakeLockActive,
    error: response?.error
  };
}

function storeCookingMode(tabId: number, recipe: NonNullable<ActionResult["recipe"]>, wakeLockActive: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.session.get(storageKey, ({ cookingMode }: { cookingMode?: StoredCookingMode }) => {
      const state: StoredCookingMode = { recipe, tabId, wakeLockActive, wakeLockMode: cookingMode?.wakeLockMode || "video" };
      chrome.storage.session.set({ [storageKey]: state }, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve();
      });
    });
  });
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function ensureContextMenu(): Promise<void> {
  await removeContextMenuIfExists();
  chrome.contextMenus.create({
    id: contextMenuId,
    title: "Open Cooking Mode",
    contexts: ["page", "video"],
    documentUrlPatterns: ["*://youtube.com/*", "*://*.youtube.com/*"]
  });
}

function removeContextMenuIfExists(): Promise<void> {
  return new Promise((resolve) => {
    chrome.contextMenus.remove(contextMenuId, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}
