import type { PermissionService } from "../permission/PermissionService";
import { applyPatchTool } from "./applyPatch";
import { editFileTool } from "./editFile";
import { globTool } from "./glob";
import { grepTool } from "./grep";
import { listDirTool } from "./listDir";
import { readFileTool } from "./readFile";
import { bashTool, runCommandTool } from "./runCommand";
import { todoWriteTool } from "./todoWrite";
import { ToolRegistry } from "./ToolRegistry";
import { writeFileTool } from "./writeFile";

export function createDefaultToolRegistry(permissionService?: PermissionService) {
  const registry = new ToolRegistry(permissionService);

  registry.register(readFileTool);
  registry.register(listDirTool);
  registry.register(grepTool);
  registry.register(globTool);
  registry.register(todoWriteTool);
  registry.register(writeFileTool);
  registry.register(editFileTool);
  registry.register(applyPatchTool);
  registry.register(runCommandTool);
  registry.register(bashTool);

  return registry;
}
