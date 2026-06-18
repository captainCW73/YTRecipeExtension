export type RecipeSource = "description" | "local-model" | "fallback";
export type WakeLockMode = "video" | "15" | "30" | "60" | "120";

export type RecipeGroup = {
  title: string;
  items: string[];
};

export type InstructionGroup = {
  title: string;
  steps: string[];
};

export type RecipePayload = {
  title: string;
  url: string;
  summary?: string;
  details?: string[];
  equipment?: string[];
  ingredientGroups?: RecipeGroup[];
  instructionGroups?: InstructionGroup[];
  notes?: string[];
  ingredients: string[];
  instructions: string[];
  fallbackText: string;
  extractedAt: number;
  likelyCooking: boolean;
  source?: RecipeSource;
  sourceNote?: string;
  modelConfidence?: number;
  modelVersion?: string;
};

export type AgentExtractRequest = {
  title: string;
  url: string;
  description: string;
  transcript: string;
};

export type AgentSettings = {
  enabled: boolean;
  backendUrl: string;
  provider?: "ollama" | "openai" | "groq" | "deepseek" | "gemini" | "claude";
  apiKey?: string;
  model?: string;
  ollamaUrl?: string;
  apiBaseUrl?: string;
};

export type RecipeVideoAnalysis = {
  likely: boolean;
  score: number;
  reasons: string[];
};

export type StoredCookingMode = {
  recipe?: RecipePayload;
  tabId?: number;
  wakeLockActive?: boolean;
  wakeLockMode?: WakeLockMode;
};

export type RuntimeMessage =
  | { type: "CONTENT_SCRIPT_READY"; url: string }
  | { type: "OPEN_COOKING_MODE"; recipe: RecipePayload; wakeLockActive: boolean }
  | { type: "OPEN_FROM_CONTENT" }
  | { type: "OPEN_PANEL_FROM_CONTENT" }
  | { type: "OPEN_FROM_POPUP"; tabId: number }
  | { type: "REQUEST_OPEN_COOKING_MODE" }
  | { type: "SHOW_COOKING_BUTTON" }
  | { type: "SHOW_BUTTON_FROM_POPUP"; tabId: number }
  | { type: "PING_CONTENT_SCRIPT" }
  | { type: "PANEL_READY" }
  | { type: "END_COOKING_MODE" }
  | { type: "EXTRACT_WITH_AGENT"; request: AgentExtractRequest }
  | { type: "SET_WAKE_LOCK_MODE"; mode: WakeLockMode }
  | { type: "WAKE_LOCK_CHANGED"; wakeLockActive: boolean };

export type ContentStatus = {
  loaded: true;
  url: string;
  isVideoPage: boolean;
  hasButton: boolean;
  title: string;
  descriptionLength: number;
};

export type ActionResult = {
  ok: boolean;
  injected?: boolean;
  error?: string;
  recipe?: RecipePayload;
  wakeLockActive?: boolean;
};

export type ContentOpenResult = ContentStatus & {
  recipe?: RecipePayload;
  wakeLockActive?: boolean;
  error?: string;
};
