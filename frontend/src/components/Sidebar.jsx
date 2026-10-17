import { Box, Button, IconButton, List, ListItemButton, ListItemText, Stack, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";

export default function Sidebar({ conversations, currentId, onSelect, onNew, onDelete }) {
  return (
    <Stack sx={{ height: "100%", p: 1.5 }}>
      <Button variant="outlined" startIcon={<AddIcon />} onClick={onNew} sx={{ mb: 1 }}>
        New chat
      </Button>

      <Box sx={{ flex: 1, overflowY: "auto", mx: -0.5 }}>
        <List dense>
          {conversations.map((c) => (
            <ListItemButton
              key={c.id}
              selected={c.id === currentId}
              onClick={() => onSelect(c.id)}
              sx={{ borderRadius: 1, "&:hover .delete": { visibility: "visible" } }}
            >
              <ListItemText primary={c.title} slotProps={{ primary: { noWrap: true } }} />
              <IconButton
                className="delete"
                size="small"
                aria-label="Delete chat"
                sx={{ visibility: c.id === currentId ? "visible" : "hidden" }}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(c.id);
                }}
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </ListItemButton>
          ))}
        </List>
        {conversations.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 1 }}>
            No chats yet.
          </Typography>
        )}
      </Box>
    </Stack>
  );
}
