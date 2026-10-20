import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  LinearProgress,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import FacebookIcon from "@mui/icons-material/Facebook";
import YouTubeIcon from "@mui/icons-material/YouTube";
import RecordVoiceOverOutlinedIcon from "@mui/icons-material/RecordVoiceOverOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import MovieCreationOutlinedIcon from "@mui/icons-material/MovieCreationOutlined";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import MakeVideoDialog from "./MakeVideoDialog";
import VideoPlayerDialog from "./VideoPlayerDialog";

// Claude Code jobs a card can start; each saves its result into the reel's JSON under the same key.
const JOB_KINDS = [
  { kind: "stt", label: "STT", icon: <RecordVoiceOverOutlinedIcon />, tip: "Speech-to-text (Traditional Chinese) with Claude Code" },
  { kind: "v2t", label: "V2T", icon: <VisibilityOutlinedIcon />, tip: "Claude Code watches the video and explains what's in it" },
];
// All jobs, for progress and errors on the card.
const JOB_LABELS = { stt: "STT", v2t: "V2T", video: "Make video" };

const isActive = (job) => job?.status === "queued" || job?.status === "running";

const clampSx = (lines) => ({
  display: "-webkit-box",
  WebkitLineClamp: lines,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
});

function useObjectUrl(file) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!file) return undefined;
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

function Field({ label, children, lines }) {
  const [expanded, setExpanded] = useState(false);
  if (!children) return null;
  const long = children.length > 80 || children.includes("\n");
  return (
    <Box>
      <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.5 }}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word", ...(expanded ? {} : clampSx(lines)) }}
      >
        {children}
      </Typography>
      {long && (
        <Button size="small" onClick={() => setExpanded((e) => !e)} sx={{ px: 0, minWidth: 0 }}>
          {expanded ? "Show less" : "Show more"}
        </Button>
      )}
    </Box>
  );
}

/**
 * reel: { id, data, error } plus either `video` (a File read in the browser) or `videoUrl` and `size` (a video the
 * backend serves). mediaAspect: the video box's CSS aspect ratio.
 */
export default function ReelCard({ reel, folder, jobs = {}, videos = [], onStart, mediaAspect = "9 / 16" }) {
  const objectUrl = useObjectUrl(reel.video);
  const videoUrl = reel.videoUrl ?? objectUrl;
  const hasVideo = Boolean(reel.video || reel.videoUrl);
  const size = reel.video?.size ?? reel.size;
  const { data } = reel;
  const isYouTube = /^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//.test(data?.url ?? "");
  const [makeOpen, setMakeOpen] = useState(false);
  const [playing, setPlaying] = useState(null); // aspect of the made video being played

  return (
    <Card variant="outlined" sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Box sx={{ bgcolor: "common.black", aspectRatio: mediaAspect, maxHeight: 480 }}>
        {videoUrl ? (
          <Box
            component="video"
            src={videoUrl}
            controls
            preload="metadata"
            sx={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
          />
        ) : (
          <Stack sx={{ height: "100%", justifyContent: "center", alignItems: "center" }}>
            <Typography variant="body2" sx={{ color: "grey.500" }}>
              No video file
            </Typography>
          </Stack>
        )}
      </Box>

      <CardContent sx={{ flex: 1, display: "flex", flexDirection: "column", gap: 1 }}>
        <Typography variant="caption" color="text.secondary" noWrap title={reel.id}>
          {reel.id}
          {size != null && ` · ${(size / 1024 / 1024).toFixed(0)} MB`}
        </Typography>
        {reel.error && <Alert severity="error">{reel.error}</Alert>}
        {!data && !reel.error && (
          <Typography variant="body2" color="text.secondary">
            No JSON file
          </Typography>
        )}
        <Field label="Summary" lines={3}>
          {data?.summary ?? data?.description}
        </Field>
        <Field label="Text" lines={4}>
          {data?.text ?? data?.title}
        </Field>
        <Field label="STT" lines={4}>
          {data?.stt}
        </Field>
        <Field label="V2T" lines={6}>
          {data?.v2t}
        </Field>
        {videos.length > 0 && (
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.5 }}>
              Made videos
            </Typography>
            {videos.map((aspect) => (
              <Chip
                key={aspect}
                size="small"
                color="primary"
                icon={<PlayArrowIcon />}
                label={aspect.replace("x", ":")}
                onClick={() => setPlaying(aspect)}
              />
            ))}
          </Stack>
        )}
        {Object.entries(JOB_LABELS).map(([kind, label]) => {
          const job = jobs[kind];
          if (isActive(job)) {
            return (
              <Box key={kind}>
                <LinearProgress />
                <Typography variant="caption" color="text.secondary">
                  {label}
                {kind === "video" && job.options?.aspect && ` ${job.options.aspect.replace("x", ":")}`}
                {kind === "video" && job.options?.max_minutes && ` ≤ ${job.options.max_minutes} min`}: {job.step || "Working…"}
                </Typography>
              </Box>
            );
          }
          if (job?.status === "failed") {
            return (
              <Alert key={kind} severity="error">
                {label} failed: {job.error}
              </Alert>
            );
          }
          return null;
        })}
      </CardContent>

      <CardActions sx={{ pt: 0, flexWrap: "wrap", rowGap: 1 }}>
        {JOB_KINDS.map(({ kind, label, icon, tip }) => (
          <Tooltip key={kind} title={data?.[kind] ? `Redo: ${tip}` : tip}>
            <span>
              <Button
                size="small"
                variant="outlined"
                startIcon={icon}
                onClick={() => onStart(kind)}
                disabled={!hasVideo || isActive(jobs[kind])}
              >
                {label}
              </Button>
            </span>
          </Tooltip>
        ))}
        <Tooltip title="Claude Code makes an anime-style explainer video from the text, summary, STT and V2T">
          <span>
            <Button
              size="small"
              variant="outlined"
              startIcon={<MovieCreationOutlinedIcon />}
              onClick={() => setMakeOpen(true)}
              disabled={!hasVideo || isActive(jobs.video)}
            >
              Make video
            </Button>
          </span>
        </Tooltip>
        {data?.url && (
          <Button
            size="small"
            startIcon={isYouTube ? <YouTubeIcon /> : <FacebookIcon />}
            href={data.url}
            target="_blank"
            rel="noreferrer"
          >
            {isYouTube ? "YouTube" : "Reel"}
          </Button>
        )}
      </CardActions>

      <MakeVideoDialog
        open={makeOpen}
        made={videos}
        onClose={() => setMakeOpen(false)}
        onConfirm={({ aspect, maxMinutes }) => {
          setMakeOpen(false);
          onStart("video", { aspect, max_minutes: maxMinutes });
        }}
      />
      <VideoPlayerDialog folder={folder} reelId={reel.id} aspect={playing} onClose={() => setPlaying(null)} />
    </Card>
  );
}
