import { useState } from "react";
import {
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";

export const ASPECTS = [
  { id: "9x16", label: "9:16", hint: "Portrait · Reels, Shorts", w: 9, h: 16 },
  { id: "16x9", label: "16:9", hint: "Landscape · YouTube", w: 16, h: 9 },
];

export const MAX_MINUTES = [3, 5, 8, 12];

function AspectOption({ aspect, selected, onSelect }) {
  const scale = 4.5;
  return (
    <ButtonBase
      onClick={onSelect}
      aria-pressed={selected}
      sx={{
        flex: 1,
        flexDirection: "column",
        gap: 1.5,
        p: 2,
        border: 2,
        borderColor: selected ? "primary.main" : "divider",
        bgcolor: selected ? "action.selected" : "transparent",
        borderRadius: 2,
      }}
    >
      <Box sx={{ height: 16 * scale, display: "flex", alignItems: "center" }}>
        <Box
          sx={{
            width: aspect.w * scale,
            height: aspect.h * scale,
            border: 3,
            borderColor: selected ? "primary.main" : "text.secondary",
            borderRadius: 1,
          }}
        />
      </Box>
      <Typography sx={{ fontWeight: 700 }}>{aspect.label}</Typography>
      <Typography variant="caption" color="text.secondary">
        {aspect.hint}
      </Typography>
    </ButtonBase>
  );
}

export default function MakeVideoDialog({ open, onClose, onConfirm, made = [] }) {
  const [aspect, setAspect] = useState("9x16");
  const [maxMinutes, setMaxMinutes] = useState(3);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Make video</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Claude Code turns the text, summary, STT and V2T into an anime-style explainer with Traditional Chinese
          narration. It takes several minutes.
        </Typography>
        <Stack direction="row" spacing={2}>
          {ASPECTS.map((a) => (
            <AspectOption key={a.id} aspect={a} selected={aspect === a.id} onSelect={() => setAspect(a.id)} />
          ))}
        </Stack>
        <Typography variant="subtitle2" sx={{ mt: 2.5, mb: 1 }}>
          Length limit
        </Typography>
        <ToggleButtonGroup
          exclusive
          fullWidth
          size="small"
          color="primary"
          value={maxMinutes}
          onChange={(_, value) => value && setMaxMinutes(value)}
        >
          {MAX_MINUTES.map((m) => (
            <ToggleButton key={m} value={m}>
              {m} min
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
          Longer content is cut down to fit; shorter content stays as it is.
        </Typography>
        {made.includes(aspect) && (
          <Typography variant="caption" color="warning.main" sx={{ display: "block", mt: 1.5 }}>
            A {aspect.replace("x", ":")} video already exists; it's replaced when the new one is done.
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => onConfirm({ aspect, maxMinutes })}>
          Make video
        </Button>
      </DialogActions>
    </Dialog>
  );
}
