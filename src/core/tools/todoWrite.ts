import type { ToolDefinition } from "./ToolRegistry";

type TodoItem = {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
  priority?: "low" | "medium" | "high";
};

export const todoWriteTool: ToolDefinition = {
  name: "todo_write",
  description: "Update the current task todo list.",
  async execute(input) {
    const todos = parseInput(input);

    return {
      content: todos.map((todo) => `- [${formatStatus(todo.status)}] ${todo.content}`).join("\n"),
      data: {
        todos
      }
    };
  }
};

function parseInput(input: unknown): TodoItem[] {
  if (!isObject(input) || !Array.isArray(input.todos)) {
    throw new Error("todo_write input must be { todos: TodoItem[] }.");
  }

  return input.todos.map((todo, index) => {
    if (!isObject(todo)) {
      throw new Error(`todo ${index} must be an object.`);
    }

    if (typeof todo.id !== "string" || typeof todo.content !== "string" || !isStatus(todo.status)) {
      throw new Error(`todo ${index} is missing id, content, or valid status.`);
    }

    return {
      id: todo.id,
      content: todo.content,
      status: todo.status,
      priority: isPriority(todo.priority) ? todo.priority : undefined
    };
  });
}

function formatStatus(status: TodoItem["status"]) {
  switch (status) {
    case "pending":
      return " ";
    case "in_progress":
      return "~";
    case "completed":
      return "x";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStatus(value: unknown): value is TodoItem["status"] {
  return value === "pending" || value === "in_progress" || value === "completed";
}

function isPriority(value: unknown): value is TodoItem["priority"] {
  return value === "low" || value === "medium" || value === "high";
}
