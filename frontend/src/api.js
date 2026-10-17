async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  models: () => request("/models"),
  listConversations: () => request("/conversations"),
  getConversation: (id) => request(`/conversations/${id}`),
  createConversation: (model) =>
    request("/conversations", { method: "POST", body: JSON.stringify({ model }) }),
  updateConversation: (id, patch) =>
    request(`/conversations/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteConversation: (id) => request(`/conversations/${id}`, { method: "DELETE" }),
};

/**
 * Send a chat message and stream Claude Code's reply as server-sent events.
 * Calls onEvent for each event; resolves when the stream ends.
 */
export async function streamMessage(conversationId, content, { onEvent, signal }) {
  const res = await fetch(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`${res.status} ${res.statusText}`);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let sep;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const data = chunk
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("\n");
      if (data) onEvent(JSON.parse(data));
    }
  }
}

/** Fold a streamed event into a list of content blocks (mirrors the backend). */
export function applyEvent(blocks, event) {
  const last = blocks[blocks.length - 1];
  switch (event.type) {
    case "text":
      if (last?.type === "text" && !last.closed) {
        return [...blocks.slice(0, -1), { ...last, text: last.text + event.text }];
      }
      return [...blocks, { type: "text", text: event.text }];
    case "message_start":
      return last?.type === "text" ? [...blocks.slice(0, -1), { ...last, closed: true }] : blocks;
    case "tool_use":
    case "tool_result":
      return [...blocks, event];
    case "result":
      return event.is_error
        ? [...blocks, { type: "error", text: event.result || event.subtype }]
        : blocks;
    case "error":
      return [...blocks, { type: "error", text: event.text }];
    default:
      return blocks;
  }
}
