/**
 * Read a local folder of downloaded reels in the browser: `<id>.mp4` + `<id>.json` pairs.
 * Files stay on disk; videos play straight from the File objects.
 */

const VIDEO_EXTS = ["mp4", "mov", "webm", "m4v", "mkv"];
const DB_NAME = "video2text-demo";
const STORE = "handles";
const HANDLE_KEY = "reels-folder";

export const supportsDirectoryPicker = typeof window !== "undefined" && "showDirectoryPicker" in window;

function splitName(name) {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? [name, ""] : [name.slice(0, dot), name.slice(dot + 1).toLowerCase()];
}

/** Group files by base name into reels, newest first. */
async function buildReels(files) {
  const byId = new Map();
  for (const file of files) {
    const [id, ext] = splitName(file.name);
    if (ext !== "json" && !VIDEO_EXTS.includes(ext)) continue;
    const reel = byId.get(id) ?? { id, video: null, jsonFile: null };
    if (ext === "json") reel.jsonFile = file;
    else reel.video = file;
    byId.set(id, reel);
  }

  const reels = await Promise.all(
    [...byId.values()].map(async ({ id, video, jsonFile }) => {
      let data = null;
      let error = null;
      if (jsonFile) {
        try {
          data = JSON.parse(await jsonFile.text());
        } catch (e) {
          error = `Cannot read ${jsonFile.name}: ${e.message}`;
        }
      }
      const modified = Math.max(video?.lastModified ?? 0, jsonFile?.lastModified ?? 0);
      return { id, video, data, error, modified };
    })
  );
  return reels.sort((a, b) => b.modified - a.modified || a.id.localeCompare(b.id));
}

/** Read the top level of a directory handle (File System Access API). */
export async function readDirectoryHandle(handle) {
  const files = [];
  for await (const entry of handle.values()) {
    if (entry.kind === "file") files.push(await entry.getFile());
  }
  return buildReels(files);
}

/** Read files from an `<input webkitdirectory>` (browsers without showDirectoryPicker). */
export async function readFileList(fileList) {
  const files = [...fileList];
  // webkitRelativePath is "<folder>/<file>" for top-level files; skip subfolders.
  const topLevel = files.filter((f) => f.webkitRelativePath.split("/").length === 2);
  const name = files[0]?.webkitRelativePath.split("/")[0] ?? "";
  return { name, reels: await buildReels(topLevel) };
}

// The last picked folder is remembered in IndexedDB so it can be reopened after a reload.
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function saveHandle(handle) {
  try {
    await withStore("readwrite", (store) => store.put(handle, HANDLE_KEY));
  } catch {
    // Not remembering the folder is fine; it just has to be picked again next time.
  }
}

export async function loadHandle() {
  try {
    return (await withStore("readonly", (store) => store.get(HANDLE_KEY))) ?? null;
  } catch {
    return null;
  }
}
