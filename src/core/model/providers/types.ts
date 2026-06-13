import type { AvailableModel, ModelProviderId } from "../ModelClient";

export type ProviderInfo = {
  id: ModelProviderId;
  label: string;
  requiresApiKey: boolean;
  requiresBaseUrl?: boolean;
};

export type ProviderModelResult = {
  models: AvailableModel[];
};

export type ProviderConfig = {
  apiKey?: string;
  baseUrl?: string;
};

export interface ModelProvider {
  info: ProviderInfo;
  listModels(config: ProviderConfig): Promise<ProviderModelResult>;
}
