/**
 * Persists a writable directory handle for …/yoga (user picks parent once).
 * Uses IndexedDB (Chromium File System Access API).
 */

const IDB_NAME = "YogaPoseDetectorLocal";
const IDB_VERSION = 1;
const STORE = "handles";
const KEY_YOGA_ROOT = "yogaRoot";
export const LOCAL_YOGA_SUBDIR = "yoga";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
  });
}

/**
 * @returns {Promise<FileSystemDirectoryHandle | null>}
 */
export async function loadStoredYogaRootHandle() {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const g = tx.objectStore(STORE).get(KEY_YOGA_ROOT);
      g.onsuccess = () => resolve(g.result ?? null);
      g.onerror = () => reject(g.error);
    });
  } catch {
    return null;
  }
}

/**
 * @param {FileSystemDirectoryHandle} handle
 */
export async function storeYogaRootHandle(handle) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const p = tx.objectStore(STORE).put(handle, KEY_YOGA_ROOT);
    p.onsuccess = () => resolve();
    p.onerror = () => reject(p.error);
  });
}

/**
 * @param {FileSystemDirectoryHandle} handle
 * @returns {Promise<boolean>}
 */
export async function ensureWritePermission(handle) {
  if (!handle || typeof handle.queryPermission !== "function") return false;
  const opts = { mode: "readwrite" };
  try {
    if ((await handle.queryPermission(opts)) === "granted") return true;
    if ((await handle.requestPermission(opts)) === "granted") return true;
  } catch {
    return false;
  }
  return false;
}

export function isLocalFolderPickerSupported() {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

/**
 * User picks a parent directory; …/yoga is created (if needed) and remembered.
 * @returns {Promise<FileSystemDirectoryHandle>}
 */
export async function pickParentAndCreateYogaFolder() {
  if (!isLocalFolderPickerSupported()) {
    throw new Error("Local folder choice is not supported in this browser.");
  }
  const parent = await window.showDirectoryPicker();
  const yoga = await parent.getDirectoryHandle(LOCAL_YOGA_SUBDIR, {
    create: true,
  });
  await storeYogaRootHandle(yoga);
  return yoga;
}

/**
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} fileName
 * @param {Blob} blob
 */
export async function writeBlobToDirectory(dirHandle, fileName, blob) {
  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

/**
 * Restore handle from IDB and ensure permission (may prompt).
 * @returns {Promise<FileSystemDirectoryHandle | null>}
 */
export async function getReadyYogaRootHandle() {
  const h = await loadStoredYogaRootHandle();
  if (!h) return null;
  const ok = await ensureWritePermission(h);
  return ok ? h : null;
}
