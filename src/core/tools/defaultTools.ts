import { globTool } from "./glob";
import { grepTool } from "./grep";
import { listDirTool } from "./listDir";
import { readFileTool } from "./readFile";
import { todoWriteTool } from "./todoWrite";
import { ToolRegistry } from "./ToolRegistry";

export function createDefaultToolRegistry() {
  const registry = new ToolRegistry();

  registry.register(readFileTool);
  registry.register(listDirTool);
  registry.register(grepTool);
  registry.register(globTool);
  registry.register(todoWriteTool);

  return registry;
}
