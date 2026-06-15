/**
 * Persistence — localStorage adapter (Build-Spec §2).
 *
 * Three namespaced keys:
 *   stillpoint.last  — current working Session (written on every mutation)
 *   stillpoint.saved — Session[] bookmarks (upsert by case-insensitive name, newest first)
 *   stillpoint.sound — SoundParams object (replaces the EDITMODE/host mechanism)
 *
 * All reads and writes are wrapped in try/catch — private-mode or quota
 * failures are non-fatal and silently ignored.
 */

import type { Session } from '../types.js';
import { DEFAULT_PRESET } from '../types.js';
import { DEFAULT_SOUND_PARAMS } from '../audio/AudioEngine.js';
import type { SoundParams } from '../audio/AudioEngine.js';

const KEY_LAST  = 'stillpoint.last';
const KEY_SAVED = 'stillpoint.saved';
const KEY_SOUND = 'stillpoint.sound';

// ── Helpers ────────────────────────────────────────────────────────────────────

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota exceeded or private browsing — non-fatal
  }
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ── Working session ────────────────────────────────────────────────────────────

/**
 * Load the current working session.
 * Returns a clone of DEFAULT_PRESET when nothing is stored yet (Build-Spec §2).
 */
export function loadLast(): Session {
  return readJSON<Session>(KEY_LAST) ?? deepClone(DEFAULT_PRESET);
}

/**
 * Persist the current working session.
 * Call on every mutation: name change, time/sound edit, add/remove segment, load, clear.
 */
export function saveLast(session: Session): void {
  writeJSON(KEY_LAST, session);
}

// ── Bookmarks ──────────────────────────────────────────────────────────────────

/** Load the bookmarked sessions list (newest first). */
export function loadSaved(): Session[] {
  return readJSON<Session[]>(KEY_SAVED) ?? [];
}

/**
 * Upsert a session into the bookmarks list.
 * Matches existing entries by case-insensitive name and replaces in place;
 * new entries are prepended (newest first).
 */
export function upsertSaved(session: Session): void {
  const list = loadSaved();
  const name = session.name.trim().toLowerCase();
  const idx  = list.findIndex((s) => s.name.trim().toLowerCase() === name);
  const entry = deepClone(session);
  if (idx !== -1) {
    list[idx] = entry;
  } else {
    list.unshift(entry);
  }
  writeJSON(KEY_SAVED, list);
}

/**
 * Delete a bookmark by its index in the saved list.
 * No-op for out-of-range indices.
 */
export function deleteSaved(index: number): void {
  const list = loadSaved();
  if (index < 0 || index >= list.length) return;
  list.splice(index, 1);
  writeJSON(KEY_SAVED, list);
}

// ── Sound params ───────────────────────────────────────────────────────────────

/**
 * Load persisted sound params, falling back to defaults for any missing key.
 * This replaces the EDITMODE/host-rewrite mechanism from the reference build.
 */
export function loadSoundParams(): SoundParams {
  const stored = readJSON<Partial<SoundParams>>(KEY_SOUND) ?? {};
  return { ...DEFAULT_SOUND_PARAMS, ...stored };
}

/** Persist the full sound params object. */
export function saveSoundParams(params: SoundParams): void {
  writeJSON(KEY_SOUND, params);
}
