export type ActiveMention = {
  start: number;
  end: number;
  query: string;
};

export function getActiveMention(value: string, cursor: number): ActiveMention | undefined {
  const beforeCursor = value.slice(0, cursor);
  const at = beforeCursor.lastIndexOf("@");

  if (at === -1) {
    return undefined;
  }

  const token = beforeCursor.slice(at + 1);

  if (/[\s,;]/.test(token) || token.includes("\n")) {
    return undefined;
  }

  return {
    start: at,
    end: cursor,
    query: token
  };
}

export function applyMention(value: string, mention: ActiveMention, path: string) {
  const replacement = `@${path}`;
  const nextValue = value.slice(0, mention.start) + replacement + value.slice(mention.end);

  return {
    value: nextValue,
    cursor: mention.start + replacement.length
  };
}
