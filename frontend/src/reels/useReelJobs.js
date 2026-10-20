import { useEffect, useRef, useState } from "react";
import { api } from "../api";

const POLL_MS = 3000;
export const isActive = (job) => job?.status === "queued" || job?.status === "running";
const flattenJobs = (jobs) => Object.values(jobs).flatMap((byKind) => Object.values(byKind));

/**
 * Claude Code jobs (STT, V2T, Make video) for the reels of one folder. They run in the backend; poll them while any
 * are queued or running, and show a job's saved JSON on its reel (via setReels) once it finishes.
 */
export default function useReelJobs(folderName, setReels) {
  const [jobs, setJobs] = useState({}); // { reelId: { stt, v2t, video } }
  const [videos, setVideos] = useState({}); // made videos as { reelId: ["9x16", "16x9"] }

  useEffect(() => {
    setJobs({});
    setVideos({});
  }, [folderName]);

  const anyActive = flattenJobs(jobs).some(isActive);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  useEffect(() => {
    if (!folderName) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const { jobs: latest, videos: made } = await api.reelJobs(folderName);
        if (cancelled) return;
        // Show the saved result on a card once a job finishes. Jobs run one at a time, so the JSON saved by
        // the most recently finished job of a reel already includes the results of earlier ones.
        const freshData = {};
        for (const [id, byKind] of Object.entries(latest)) {
          for (const [kind, job] of Object.entries(byKind)) {
            const isNew = kind !== "video" && job.status === "done" && job.data && jobsRef.current[id]?.[kind]?.updated_at !== job.updated_at;
            if (isNew && (!freshData[id] || freshData[id].updated_at < job.updated_at)) freshData[id] = job;
          }
        }
        if (Object.keys(freshData).length) {
          setReels((rs) => rs.map((r) => (freshData[r.id] ? { ...r, data: freshData[r.id].data, error: null } : r)));
        }
        setVideos(made);
        setJobs((prev) => {
          const next = { ...prev };
          for (const [id, byKind] of Object.entries(latest)) next[id] = { ...prev[id], ...byKind };
          return next;
        });
      } catch {
        // The backend may be restarting; try again on the next tick.
      }
    };
    poll();
    if (!anyActive) return () => (cancelled = true);
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [folderName, anyActive, setReels]);

  const startJob = async (reelId, kind, options) => {
    const setJob = (job) => setJobs((prev) => ({ ...prev, [reelId]: { ...prev[reelId], [kind]: job } }));
    setJob({ status: "queued", step: "Starting…" });
    try {
      setJob(await api.startReelJob(folderName, reelId, kind, options));
    } catch (e) {
      setJob({ status: "failed", error: e.message });
    }
  };

  return { jobs, videos, startJob };
}
