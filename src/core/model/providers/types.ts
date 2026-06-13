import type { AvailableModel, ModelProviderId } from "../ModelClient";

export type ProviderInfo = {
  id: ModelProviderId;
  label: string;
  requiresApiKey: boolean;
};

export type ProviderModelResult = {
  models: AvailableModel[];
};

export interface ModelProvider {
  info: ProviderInfo;
  listModels(apiKey?: string): Promise<ProviderModelResult>;
}
