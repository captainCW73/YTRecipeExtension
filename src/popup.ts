import type { ActionResult, AgentSettings, ContentStatus, RuntimeMessage } from "./types";

const settingsKey = "cookingModeAgentSettings";
const statusNode = byId<HTMLElement>("status");
const openButton = byId<HTMLButtonElement>("open-button");
const showButton = byId<HTMLButtonElement>("show-button");
const pageButton = byId<HTMLButtonElement>("page-button");
const debugButton = byId<HTMLButtonElement>("debug-button");
const backendUrl = byId<HTMLInputElement>("backend-url");
const provider = byId<HTMLSelectElement>("provider");
const ollamaUrl = byId<HTMLInputElement>("ollama-url");
const apiKey = byId<HTMLInputElement>("api-key");
const apiBaseUrl = byId<HTMLInputElement>("api-base-url");
const model = byId<HTMLInputElement>("model");
const agentEnabled = byId<HTMLInputElement>("agent-enabled");
const saveSettings = byId<HTMLButtonElement>("save-settings");

let activeTabId: number | undefined;

init();

async function init(): Promise<void> {
  await loadSettings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id;

  const isYouTube = Boolean(tab?.url && /^https?:\/\/([^/]+\.)?youtube\.com\//.test(tab.url));
  openButton.disabled = !activeTabId || !isYouTube;
  showButton.disabled = !activeTabId || !isYouTube;
  pageButton.disabled = !activeTabId || !isYouTube;
  statusNode.textContent = isYouTube ? "Checking page connection..." : "Open YouTube first.";
  if (activeTabId && isYouTube) await refreshStatus(activeTabId);
}

openButton.addEventListener("click", async () => {
  if (!activeTabId) return;
  openButton.disabled = true;
  statusNode.textContent = "Opening side panel...";
  await chrome.sidePanel.open({ tabId: activeTabId }).catch(() => undefined);
  const message: RuntimeMessage = { type: "OPEN_FROM_POPUP", tabId: activeTabId };
  const result = await chrome.runtime.sendMessage(message) as ActionResult | undefined;
  if (!result?.ok) {
    statusNode.textContent = `Could not connect: ${result?.error || "unknown error"}`;
    openButton.disabled = false;
    return;
  }
  window.close();
});

showButton.addEventListener("click", async () => {
  if (!activeTabId) return;
  showButton.disabled = true;
  statusNode.textContent = "Showing page button...";
  const message: RuntimeMessage = { type: "SHOW_BUTTON_FROM_POPUP", tabId: activeTabId };
  const result = await chrome.runtime.sendMessage(message) as ActionResult | undefined;
  if (!result?.ok) {
    statusNode.textContent = `Could not inject: ${result?.error || "unknown error"}`;
    showButton.disabled = false;
    return;
  }
  await new Promise((resolve) => window.setTimeout(resolve, 300));
  await refreshStatus(activeTabId);
  window.setTimeout(() => window.close(), 900);
});

pageButton.addEventListener("click", async () => {
  if (!activeTabId) return;
  pageButton.disabled = true;
  statusNode.textContent = "Opening full page...";
  const message: RuntimeMessage = { type: "OPEN_FROM_POPUP", tabId: activeTabId };
  const result = await chrome.runtime.sendMessage(message) as ActionResult | undefined;
  if (!result?.ok) {
    statusNode.textContent = `Could not connect: ${result?.error || "unknown error"}`;
    pageButton.disabled = false;
    return;
  }
  await chrome.tabs.create({ url: chrome.runtime.getURL("cooking.html") });
  window.close();
});

debugButton.addEventListener("click", async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL("debug.html") });
  window.close();
});

saveSettings.addEventListener("click", async () => {
  const settings: AgentSettings = {
    enabled: agentEnabled.checked,
    backendUrl: backendUrl.value.trim() || "http://127.0.0.1:8787",
    provider: provider.value as AgentSettings["provider"],
    ollamaUrl: ollamaUrl.value.trim() || "http://127.0.0.1:11434",
    apiKey: apiKey.value.trim() || undefined,
    apiBaseUrl: apiBaseUrl.value.trim() || undefined,
    model: model.value.trim() || defaultModel(provider.value)
  };
  await chrome.storage.local.set({ [settingsKey]: settings });
  saveSettings.textContent = "Saved";
  window.setTimeout(() => {
    saveSettings.textContent = "Save Agent Settings";
  }, 1100);
});

async function loadSettings(): Promise<void> {
  const state = await chrome.storage.local.get(settingsKey) as { cookingModeAgentSettings?: AgentSettings };
  const settings = state.cookingModeAgentSettings || {
    enabled: true,
    backendUrl: "http://127.0.0.1:8787",
    provider: "ollama",
    model: "llama3.2:3b",
    ollamaUrl: "http://127.0.0.1:11434"
  };
  agentEnabled.checked = settings.enabled;
  backendUrl.value = settings.backendUrl;
  provider.value = settings.provider || "ollama";
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

async function refreshStatus(tabId: number): Promise<void> {
  const ping: RuntimeMessage = { type: "PING_CONTENT_SCRIPT" };
  const status = await chrome.tabs.sendMessage(tabId, ping).catch(async () => {
    const repair: RuntimeMessage = { type: "SHOW_BUTTON_FROM_POPUP", tabId };
    await chrome.runtime.sendMessage(repair);
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    return chrome.tabs.sendMessage(tabId, ping).catch(() => undefined);
  }) as ContentStatus | undefined;

  if (!status?.loaded) {
    statusNode.textContent = "Not connected. Try reload page.";
    return;
  }

  if (status.hasButton) {
    statusNode.textContent = "Connected. Page button visible.";
    return;
  }

  statusNode.textContent = status.isVideoPage ? "Connected. Click Show Page Button." : "Connected, but not video page.";
}

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}
