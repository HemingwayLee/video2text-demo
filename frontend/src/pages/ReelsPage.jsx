import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Grid,
  MenuItem,
  Pagination,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import FolderOpenOutlinedIcon from "@mui/icons-material/FolderOpenOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import ReelCard from "../reels/ReelCard";
import useReelJobs from "../reels/useReelJobs";
import {
  loadHandle,
  readDirectoryHandle,
  readFileList,
  saveHandle,
  supportsDirectoryPicker,
} from "../reels/folderSource";

const PAGE_SIZES = [8, 12, 24, 48];

export default function ReelsPage() {
  const [folder, setFolder] = useState(null); // { name, handle? }
  const [savedHandle, setSavedHandle] = useState(null); // remembered folder awaiting permission
  const [reels, setReels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);

  const inputRef = useRef(null);
  const topRef = useRef(null);

  const show = (name, handle, list) => {
    setFolder({ name, handle });
    setReels(list);
    setPage(1);
  };

  const load = async (fn) => {
    setError(null);
    setLoading(true);
    try {
      await fn();
    } catch (e) {
      if (e.name !== "AbortError") setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const openHandle = (handle) =>
    load(async () => {
      show(handle.name, handle, await readDirectoryHandle(handle));
      setSavedHandle(null);
    });

  // Reopen the last folder without a prompt if Chrome still grants access to it.
  useEffect(() => {
    if (!supportsDirectoryPicker) return;
    loadHandle().then(async (handle) => {
      if (!handle) return;
      if ((await handle.queryPermission({ mode: "read" })) === "granted") openHandle(handle);
      else setSavedHandle(handle);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickFolder = () => {
    if (!supportsDirectoryPicker) {
      inputRef.current?.click();
      return;
    }
    load(async () => {
      const handle = await window.showDirectoryPicker({ id: "reels", mode: "read" });
      await saveHandle(handle);
      show(handle.name, handle, await readDirectoryHandle(handle));
      setSavedHandle(null);
    });
  };

  const reopenSaved = () =>
    load(async () => {
      if ((await savedHandle.requestPermission({ mode: "read" })) !== "granted") {
        throw new Error("Permission to read the folder was denied.");
      }
      await openHandle(savedHandle);
    });

  const onInputChange = (e) => {
    const { files } = e.target;
    if (!files?.length) return;
    load(async () => {
      const { name, reels: list } = await readFileList(files);
      show(name, null, list);
    });
    e.target.value = "";
  };

  const folderName = folder?.name;
  const { jobs, videos, startJob } = useReelJobs(folderName, setReels);

  const pageCount = Math.max(1, Math.ceil(reels.length / pageSize));
  const visible = reels.slice((page - 1) * pageSize, page * pageSize);

  const changePage = (next) => {
    setPage(next);
    topRef.current?.scrollIntoView({ block: "start" });
  };

  return (
    <Box sx={{ flex: 1, overflowY: "auto", px: 2 }}>
      <Box ref={topRef} sx={{ maxWidth: 1400, mx: "auto", py: 2 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1, mb: 2 }}>
          <Button variant="contained" startIcon={<FolderOpenOutlinedIcon />} onClick={pickFolder} disabled={loading}>
            {folder ? "Change folder" : "Select folder"}
          </Button>
          {folder?.handle && (
            <Button startIcon={<RefreshIcon />} onClick={() => openHandle(folder.handle)} disabled={loading}>
              Reload
            </Button>
          )}
          {savedHandle && !folder && (
            <Button variant="outlined" onClick={reopenSaved} disabled={loading}>
              Reopen “{savedHandle.name}”
            </Button>
          )}
          {loading && <CircularProgress size={20} />}
          <Box sx={{ flex: 1 }} />
          {folder && (
            <>
              <Typography variant="body2" color="text.secondary">
                <b>{folder.name}</b> · {reels.length} reels
              </Typography>
              <Select
                size="small"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(e.target.value);
                  setPage(1);
                }}
              >
                {PAGE_SIZES.map((n) => (
                  <MenuItem key={n} value={n}>
                    {n} / page
                  </MenuItem>
                ))}
              </Select>
            </>
          )}
        </Stack>

        <input ref={inputRef} type="file" webkitdirectory="" hidden onChange={onInputChange} />

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {!folder && !loading && (
          <Typography color="text.secondary" sx={{ textAlign: "center", mt: 8 }}>
            Select a folder of downloaded reels (<code>&lt;id&gt;.mp4</code> + <code>&lt;id&gt;.json</code>).
            Files are read in your browser and never uploaded.
          </Typography>
        )}

        {folder && reels.length === 0 && !loading && (
          <Typography color="text.secondary" sx={{ textAlign: "center", mt: 8 }}>
            No video or JSON files in this folder.
          </Typography>
        )}

        <Grid container spacing={2}>
          {visible.map((reel) => (
            <Grid key={reel.id} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
              <ReelCard
                reel={reel}
                folder={folderName}
                jobs={jobs[reel.id]}
                videos={videos[reel.id]}
                onStart={(kind, options) => startJob(reel.id, kind, options)}
              />
            </Grid>
          ))}
        </Grid>

        {pageCount > 1 && (
          <Stack sx={{ alignItems: "center", mt: 3 }}>
            <Pagination count={pageCount} page={page} onChange={(_, p) => changePage(p)} color="primary" />
          </Stack>
        )}
      </Box>
    </Box>
  );
}
