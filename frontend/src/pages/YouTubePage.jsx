import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Grid,
  LinearProgress,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Pagination,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import { api, sourceVideoUrl } from "../api";
import ReelCard from "../reels/ReelCard";
import useReelJobs from "../reels/useReelJobs";

const COUNTS = [1, 3, 5, 10, 20, 30, 50];
const PAGE_SIZE = 12;
const POLL_MS = 3000;
const FOLDER_PREFIX = "youtube-";

const handleOf = (folder) => `@${folder.slice(FOLDER_PREFIX.length)}`;
const withVideoUrls = (folder, reels) => reels.map((r) => ({ ...r, videoUrl: sourceVideoUrl(folder, r.id) }));

function DownloadStatus({ job }) {
  if (!job) return null;
  const done = job.downloaded + job.skipped + job.failed.length;
  return (
    <Stack spacing={1}>
      {job.status === "running" && (
        <Box>
          <LinearProgress
            variant={job.progress != null ? "determinate" : "indeterminate"}
            value={(job.progress ?? 0) * 100}
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5, wordBreak: "break-word" }}>
            {job.step}
          </Typography>
        </Box>
      )}
      <Typography variant="body2" color="text.secondary">
        {job.channel}: {done} of {job.total} · {job.downloaded} downloaded
        {job.skipped > 0 && `, ${job.skipped} already here`}
        {job.failed.length > 0 && `, ${job.failed.length} failed`}
      </Typography>
      {job.status === "failed" && <Alert severity="error">Download failed: {job.error}</Alert>}
      {job.failed.map((f) => (
        <Alert key={f.id} severity="warning">
          {f.title || f.id}: {f.error}
        </Alert>
      ))}
    </Stack>
  );
}

export default function YouTubePage() {
  const [channel, setChannel] = useState("");
  const [count, setCount] = useState(5);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);
  const [channels, setChannels] = useState([]); // downloaded channel folders
  const [folder, setFolder] = useState(null); // the channel whose videos are shown
  const [reels, setReels] = useState([]);
  const [job, setJob] = useState(null); // the shown channel's download job
  const [page, setPage] = useState(1);
  const topRef = useRef(null);

  const { jobs, videos, startJob } = useReelJobs(folder, setReels);

  const loadChannels = useCallback(() => api.youtubeChannels().then(setChannels).catch(() => {}), []);
  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  // Load the shown channel's videos; while it's downloading, poll so new videos appear as they finish.
  const downloading = job?.status === "running";
  useEffect(() => {
    if (!folder) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const { reels: latest, job: latestJob } = await api.youtubeChannel(folder);
        if (cancelled) return;
        setReels(withVideoUrls(folder, latest));
        setJob(latestJob);
        if (latestJob?.status !== "running") loadChannels();
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    };
    poll();
    if (!downloading) return () => (cancelled = true);
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [folder, downloading, loadChannels]);

  const show = (name) => {
    if (name === folder) return;
    setFolder(name);
    setReels([]);
    setJob(null);
    setPage(1);
  };

  const download = async (e) => {
    e.preventDefault();
    setError(null);
    setStarting(true);
    try {
      const { folder: name, job: started } = await api.startYoutubeDownload(channel, count);
      show(name);
      setJob(started);
      loadChannels();
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  };

  const pageCount = Math.max(1, Math.ceil(reels.length / PAGE_SIZE));
  const visible = reels.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <Box sx={{ flex: 1, display: "flex", flexDirection: { xs: "column", md: "row" }, minHeight: 0, overflowY: { xs: "auto", md: "hidden" } }}>
      <Paper
        variant="outlined"
        square
        sx={{
          width: { xs: "auto", md: 320 },
          flexShrink: 0,
          borderWidth: 0,
          borderRightWidth: { md: 1 },
          borderBottomWidth: { xs: 1, md: 0 },
          overflowY: { md: "auto" },
          p: 2,
        }}
      >
        <Stack component="form" spacing={2} onSubmit={download}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            Download from YouTube
          </Typography>
          <TextField
            label="Channel"
            placeholder="@handle or channel URL"
            helperText="Latest videos from the Videos tab, or the tab in the URL (…/shorts)"
            size="small"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            disabled={starting}
            fullWidth
          />
          <TextField
            select
            label="Videos"
            size="small"
            value={count}
            onChange={(e) => setCount(e.target.value)}
            disabled={starting}
          >
            {COUNTS.map((n) => (
              <MenuItem key={n} value={n}>
                Latest {n}
              </MenuItem>
            ))}
          </TextField>
          <Button
            type="submit"
            variant="contained"
            startIcon={starting ? <CircularProgress size={18} color="inherit" /> : <DownloadIcon />}
            disabled={starting || !channel.trim()}
          >
            {starting ? "Finding channel…" : "Download"}
          </Button>
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          <DownloadStatus job={job} />
        </Stack>

        {channels.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="overline" color="text.secondary">
              Downloaded channels
            </Typography>
            <List dense disablePadding>
              {channels.map((c) => (
                <ListItemButton key={c.folder} selected={c.folder === folder} onClick={() => show(c.folder)}>
                  <ListItemText primary={c.job?.channel ?? handleOf(c.folder)} secondary={`${c.count} videos`} />
                  {c.job?.status === "running" && <CircularProgress size={16} />}
                </ListItemButton>
              ))}
            </List>
          </>
        )}
      </Paper>

      <Box sx={{ flex: 1, overflowY: { md: "auto" }, px: 2 }}>
        <Box ref={topRef} sx={{ maxWidth: 1400, mx: "auto", py: 2 }}>
          {folder && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              <b>{folder}</b> · {reels.length} videos
            </Typography>
          )}

          {!folder && (
            <Typography color="text.secondary" sx={{ textAlign: "center", mt: 8 }}>
              Enter a channel and download its latest videos, or pick a downloaded channel. Videos are saved to the
              reels folder as <code>youtube-&lt;handle&gt;/&lt;id&gt;.mp4</code> + <code>&lt;id&gt;.json</code>.
            </Typography>
          )}

          {folder && reels.length === 0 && !downloading && (
            <Typography color="text.secondary" sx={{ textAlign: "center", mt: 8 }}>
              No videos in this folder yet.
            </Typography>
          )}

          <Grid container spacing={2}>
            {visible.map((reel) => (
              <Grid key={reel.id} size={{ xs: 12, sm: 6, lg: 4, xl: 3 }}>
                <ReelCard
                  reel={reel}
                  folder={folder}
                  jobs={jobs[reel.id]}
                  videos={videos[reel.id]}
                  onStart={(kind, options) => startJob(reel.id, kind, options)}
                  mediaAspect="16 / 9"
                />
              </Grid>
            ))}
          </Grid>

          {pageCount > 1 && (
            <Stack sx={{ alignItems: "center", mt: 3 }}>
              <Pagination
                count={pageCount}
                page={page}
                onChange={(_, p) => {
                  setPage(p);
                  topRef.current?.scrollIntoView({ block: "start" });
                }}
                color="primary"
              />
            </Stack>
          )}
        </Box>
      </Box>
    </Box>
  );
}
