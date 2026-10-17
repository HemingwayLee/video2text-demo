import { useState } from "react";
import { IconButton, InputBase, Paper, Tooltip } from "@mui/material";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import StopIcon from "@mui/icons-material/Stop";

export default function Composer({ onSend, onStop, streaming, autoFocus }) {
  const [value, setValue] = useState("");

  const submit = () => {
    const text = value.trim();
    if (!text || streaming) return;
    onSend(text);
    setValue("");
  };

  return (
    <Paper
      variant="outlined"
      sx={{ display: "flex", alignItems: "flex-end", gap: 1, p: 1, pl: 2, borderRadius: 4 }}
    >
      <InputBase
        multiline
        maxRows={10}
        autoFocus={autoFocus}
        placeholder="Send a message to Claude Code"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        sx={{ flex: 1, py: 0.75 }}
      />
      {streaming ? (
        <Tooltip title="Stop">
          <IconButton onClick={onStop} sx={{ bgcolor: "action.selected" }}>
            <StopIcon />
          </IconButton>
        </Tooltip>
      ) : (
        <Tooltip title="Send (Enter)">
          <span>
            <IconButton
              onClick={submit}
              disabled={!value.trim()}
              sx={{
                bgcolor: "primary.main",
                color: "primary.contrastText",
                "&:hover": { bgcolor: "primary.dark" },
              }}
            >
              <ArrowUpwardIcon />
            </IconButton>
          </span>
        </Tooltip>
      )}
    </Paper>
  );
}
