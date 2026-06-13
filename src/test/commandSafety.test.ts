import assert from "node:assert/strict";
import test from "node:test";
import { assessCommandSafety } from "../core/tools/commandSafety";

test("allows ordinary verification commands", () => {
  assert.equal(assessCommandSafety("node -v").safe, true);
  assert.equal(assessCommandSafety("npm run compile").safe, true);
  assert.equal(assessCommandSafety("git status --short").safe, true);
});

test("blocks destructive deletion commands", () => {
  assert.deepEqual(assessCommandSafety("rm -rf dist"), {
    safe: false,
    reason: "recursive force deletion with rm"
  });
  assert.equal(assessCommandSafety("Remove-Item . -Recurse -Force").safe, false);
});

test("blocks destructive git commands", () => {
  assert.equal(assessCommandSafety("git reset --hard HEAD").safe, false);
  assert.equal(assessCommandSafety("git clean -fdx").safe, false);
});
