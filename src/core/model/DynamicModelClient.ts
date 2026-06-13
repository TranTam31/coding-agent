import type { ModelClient, ModelRequest } from "./ModelClient";
import { ModelService } from "./ModelService";

export class DynamicModelClient implements ModelClient {
  constructor(private readonly modelService: ModelService) {}

  async *stream(request: ModelRequest) {
    const client = await this.modelService.createSelectedClient();
    yield* client.stream(request);
  }
}
