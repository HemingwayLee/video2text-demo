import { Box, Button, Dialog, DialogActions } from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import { madeVideoUrl } from "../api";

export default function VideoPlayerDialog({ folder, reelId, aspect, onClose }) {
  const open = Boolean(aspect);
  const portrait = aspect === "9x16";

  return (
    <Dialog open={open} onClose={onClose} maxWidth={portrait ? "sm" : "lg"} fullWidth={!portrait}>
      {open && (
        <>
          <Box sx={{ bgcolor: "common.black", display: "flex", justifyContent: "center" }}>
            <Box
              component="video"
              src={madeVideoUrl(folder, reelId, aspect)}
              controls
              autoPlay
              sx={{
                display: "block",
                width: portrait ? "auto" : "100%",
                maxWidth: "100%",
                maxHeight: "80vh",
                aspectRatio: portrait ? "9 / 16" : "16 / 9",
              }}
            />
          </Box>
          <DialogActions>
            <Button startIcon={<DownloadIcon />} href={madeVideoUrl(folder, reelId, aspect, { download: true })}>
              Download
            </Button>
            <Button onClick={onClose}>Close</Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
