// Core data schemas — Build-Spec §1. These are the single source of truth for
// the shape of a session; every module (UI, Persistence, Timer) imports from here.

/** A sound cue. UI labels: None | Chime | Bells. */
export type SoundKind = 'none' | 'chime' | 'bell';

/** Human-facing labels for each sound kind. */
export const SOUND_LABEL: Record<SoundKind, string> = {
  none: 'None',
  chime: 'Chime',
  bell: 'Bells',
};

/** All sound kinds, in display order. */
export const SOUND_KINDS: readonly SoundKind[] = ['none', 'chime', 'bell'];

/** One timed block of a session, with optional start/end cues. */
export interface Segment {
  /** Whole minutes, >= 0. */
  min: number;
  /** Seconds, 0..59. */
  sec: number;
  /** Cue played when the segment begins. */
  start: SoundKind;
  /** Cue played when the segment ends. */
  end: SoundKind;
  /**
   * Optional human label (e.g. "Body scan"). Purely decorative — segments are
   * always identified by order/index, so a name is never required. Absent or
   * blank falls back to "Segment N of M" wherever a label is shown.
   */
  name?: string;
}

/** A named, ordered list of segments. */
export interface Session {
  name: string;
  segments: Segment[];
}

/** Builder UI mode (separate from session data). */
export type Mode = 'view' | 'edit';

/** Duration of a single segment in seconds. */
export function segSeconds(s: Segment): number {
  return (Number(s.min) || 0) * 60 + (Number(s.sec) || 0);
}

/** Total duration of a session in seconds. */
export function totalSeconds(sess: Session): number {
  return sess.segments.reduce((t, s) => t + segSeconds(s), 0);
}

/** Default session, cloned at boot only when no working session is stored. */
export const DEFAULT_PRESET: Session = {
  name: 'Daily Practice',
  segments: [
    { min: 2, sec: 0, start: 'chime', end: 'none' },
    { min: 23, sec: 0, start: 'none', end: 'bell' },
  ],
};
