import { Alert, Box, Typography } from "@mui/material";
import Markdown from "./Markdown";
import ToolCall from "./ToolCall";

export default function MessageItem({ message, streaming = false }) {
  if (message.role === "user") {
    const text = message.blocks.map((b) => b.text ?? "").join("");
    return (
      <Box sx={{ display: "flex", justifyContent: "flex-end", my: 2 }}>
        <Box
          sx={{
            maxWidth: "80%",
            bgcolor: "action.selected",
            px: 2,
            py: 1.25,
            borderRadius: 3,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {text}
        </Box>
      </Box>
    );
  }

  const results = Object.fromEntries(
    message.blocks.filter((b) => b.type === "tool_result").map((b) => [b.tool_use_id, b])
  );

  return (
    <Box sx={{ my: 2 }}>
      {message.blocks.map((block, i) => {
        switch (block.type) {
          case "text":
            return <Markdown key={i}>{block.text}</Markdown>;
          case "tool_use":
            return <ToolCall key={i} tool={block} result={results[block.id]} running={streaming} />;
          case "error":
            return (
              <Alert key={i} severity="error" sx={{ my: 1 }}>
                {block.text}
              </Alert>
            );
          default:
            return null;
        }
      })}
      {streaming && message.blocks.length === 0 && (
        <Typography color="text.secondary">
          Thinking…
        </Typography>
      )}
      {!streaming && message.cost_usd != null && (
        <Typography variant="caption" color="text.disabled">
          ${message.cost_usd.toFixed(4)}
        </Typography>
      )}
    </Box>
  );
}
