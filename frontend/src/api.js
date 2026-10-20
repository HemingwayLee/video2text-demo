async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(typeof body?.detail === "string" ? body.detail : `${res.status} ${res.statusText}`);
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

  reelJobs: (folder) => request(`/reels/${encodeURIComponent(folder)}/jobs`),
  /** kind: "stt" (speech-to-text), "v2t" (explain the video) or "video" (options: { aspect: "9x16" | "16x9" }) */
  startReelJob: (folder, reelId, kind, options) =>
    request(`/reels/${encodeURIComponent(folder)}/${encodeURIComponent(reelId)}/${kind}`, {
      method: "POST",
      body: options ? JSON.stringify(options) : undefined,
    }),

  youtubeChannels: () => request("/youtube/channels"),
  youtubeChannel: (folder) => request(`/youtube/channels/${encodeURIComponent(folder)}`),
  /** Download a channel's latest `count` videos; resolves with { folder, job } once the channel is found. */
  startYoutubeDownload: (channel, count) =>
    request("/youtube/downloads", { method: "POST", body: JSON.stringify({ channel, count }) }),
};

/** A reel's own video file, served by the backend (for folders the browser doesn't read itself). */
export const sourceVideoUrl = (folder, reelId) =>
  `/api/reels/${encodeURIComponent(folder)}/${encodeURIComponent(reelId)}/source`;

export const madeVideoUrl = (folder, reelId, aspect, { download = false } = {}) =>
  `/api/reels/${encodeURIComponent(folder)}/${encodeURIComponent(reelId)}/videos/${aspect}${download ? "?download=true" : ""}`;

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
