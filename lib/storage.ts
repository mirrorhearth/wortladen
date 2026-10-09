import type { SaveData } from "./game-types";
import { VOCABULARY } from "@/data/vocabulary";

const DB_NAME = "wortladen-db";
const STORE = "saves";
const KEY = "main";

export const DEFAULT_SAVE: SaveData = {
  version: 1,
  coins: 36,
  shopLevel: 1,
  ownedDecorations: [],
  activeDecorations: [],
  unlockedWordIds: VOCABULARY.slice(0, 20).map((word) => word.id),
  customWords: [],
  learning: {},
  history: [],
  settings: { sound: true, reducedMotion: false, dailyNewWords: 20, chineseRatio: 0.7 },
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadSave(): Promise<SaveData> {
  if (typeof indexedDB === "undefined") return structuredClone(DEFAULT_SAVE);
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
    request.onsuccess = () => resolve(validateSave(request.result) ? request.result : structuredClone(DEFAULT_SAVE));
    request.onerror = () => reject(request.error);
  });
}

export async function saveGame(save: SaveData) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const request = database.transaction(STORE, "readwrite").objectStore(STORE).put(save, KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export function validateSave(value: unknown): value is SaveData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SaveData>;
  return (
    candidate.version === 1 &&
    typeof candidate.coins === "number" &&
    Array.isArray(candidate.ownedDecorations) &&
    Array.isArray(candidate.activeDecorations) &&
    Array.isArray(candidate.unlockedWordIds) &&
    Array.isArray(candidate.customWords) &&
    typeof candidate.learning === "object" &&
    Array.isArray(candidate.history) &&
    typeof candidate.settings === "object"
  );
}

export function exportSave(save: SaveData) {
  const blob = new Blob([JSON.stringify(save, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `wortladen-save-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

export async function readSaveFile(file: File): Promise<SaveData> {
  const parsed: unknown = JSON.parse(await file.text());
  if (!validateSave(parsed)) throw new Error("存档格式无效或版本不受支持。");
  return parsed;
}
