import * as vscode from "vscode";
import { FakeModelClient } from "./FakeModelClient";
import type { AvailableModel, ModelClient, ModelProviderId, ModelRef } from "./ModelClient";
import { GeminiModelClient, GeminiProvider } from "./providers/GeminiClient";
import { GroqModelClient, GroqProvider } from "./providers/GroqClient";
import type { ModelProvider, ProviderInfo } from "./providers/types";

const SELECTED_MODEL_KEY = "codingAgent.selectedModel.v1";
const MODEL_CACHE_KEY = "codingAgent.modelCache.v1";

type ModelCache = Partial<Record<ModelProviderId, AvailableModel[]>>;

export class ModelService {
  private readonly providers = new Map<ModelProviderId, ModelProvider>();

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly workspaceState: vscode.Memento
  ) {
    this.providers.set("gemini", new GeminiProvider());
    this.providers.set("groq", new GroqProvider());
  }

  getProviders(): ProviderInfo[] {
    return [
      {
        id: "fake",
        label: "Fake Local",
        requiresApiKey: false
      },
      ...[...this.providers.values()].map((provider) => provider.info)
    ];
  }

  async getProviderStates() {
    const providers = this.getProviders();

    return Promise.all(
      providers.map(async (provider) => ({
        ...provider,
        configured: provider.id === "fake" ? true : Boolean(await this.getApiKey(provider.id))
      }))
    );
  }

  getSelectedModel(): ModelRef {
    return (
      this.workspaceState.get<ModelRef>(SELECTED_MODEL_KEY) ?? {
        providerId: "fake",
        modelId: "fake-agent"
      }
    );
  }

  async setSelectedModel(model: ModelRef) {
    await this.workspaceState.update(SELECTED_MODEL_KEY, model);
  }

  getCachedModels(): ModelCache {
    return {
      fake: [getFakeModel()],
      ...this.workspaceState.get<ModelCache>(MODEL_CACHE_KEY, {})
    };
  }

  async saveApiKey(providerId: ModelProviderId, apiKey: string) {
    if (providerId === "fake") {
      return;
    }

    const trimmed = sanitizeApiKey(apiKey);

    if (!trimmed) {
      await this.secrets.delete(this.getSecretKey(providerId));
      return;
    }

    await this.secrets.store(this.getSecretKey(providerId), trimmed);
  }

  async listModels(providerId: ModelProviderId): Promise<AvailableModel[]> {
    if (providerId === "fake") {
      return [getFakeModel()];
    }

    const provider = this.providers.get(providerId);

    if (!provider) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    const apiKey = await this.getApiKey(providerId);
    const result = await provider.listModels(apiKey);
    const cache = this.getCachedModels();

    await this.workspaceState.update(MODEL_CACHE_KEY, {
      ...cache,
      [providerId]: result.models
    });

    return result.models;
  }

  async createSelectedClient(): Promise<ModelClient> {
    const selected = this.getSelectedModel();

    if (selected.providerId === "fake") {
      return new FakeModelClient();
    }

    const apiKey = await this.getApiKey(selected.providerId);

    if (!apiKey) {
      throw new Error(`Missing API key for provider: ${selected.providerId}`);
    }

    if (selected.providerId === "gemini") {
      return new GeminiModelClient(apiKey, selected.modelId);
    }

    if (selected.providerId === "groq") {
      return new GroqModelClient(apiKey, selected.modelId);
    }

    throw new Error(`Unsupported provider: ${selected.providerId}`);
  }

  private async getApiKey(providerId: ModelProviderId) {
    if (providerId === "fake") {
      return undefined;
    }

    return this.secrets.get(this.getSecretKey(providerId));
  }

  private getSecretKey(providerId: ModelProviderId) {
    return `codingAgent.provider.${providerId}.apiKey`;
  }
}

function getFakeModel(): AvailableModel {
  return {
    providerId: "fake",
    id: "fake-agent",
    label: "Fake Agent",
    description: "Local deterministic fake model for testing the agent loop."
  };
}

function sanitizeApiKey(apiKey: string) {
  return apiKey.trim().replace(/^Bearer\s+/i, "").trim();
}
