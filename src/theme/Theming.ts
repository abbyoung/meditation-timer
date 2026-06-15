/**
 * Theming — OKLCH palettes + time-of-day mapping (Build-Spec §8).
 *
 * Applies a palette-{morning|afternoon|evening|night} class to <body> based
 * on the current hour, updates the greeting and live clock.
 * Re-evaluates every 30 s and on window focus.
 */

type Palette = 'morning' | 'afternoon' | 'evening' | 'night';

interface TimeSlot {
  greeting: string;
  palette: Palette;
}

function timeSlot(h: number): TimeSlot {
  if (h >= 5  && h < 12) return { greeting: 'Good morning',   palette: 'morning'   };
  if (h >= 12 && h < 17) return { greeting: 'Good afternoon', palette: 'afternoon' };
  if (h >= 17 && h < 21) return { greeting: 'Good evening',   palette: 'evening'   };
  return                         { greeting: 'Good evening',   palette: 'night'     };
}

export function applyTimeOfDay(): void {
  const now  = new Date();
  const slot = timeSlot(now.getHours());

  // Split greeting so last word becomes an italic accent <em> (Build-Spec §8).
  const greetingEl = document.getElementById('greeting');
  if (greetingEl) {
    const words = slot.greeting.split(' ');
    const last  = words.pop()!;
    greetingEl.innerHTML = `${words.join(' ')} <em>${last}</em>`;
  }

  // Swap palette class on body.
  const body = document.body;
  for (const p of ['morning', 'afternoon', 'evening', 'night'] as const) {
    body.classList.toggle(`palette-${p}`, p === slot.palette);
  }

  // Live clock: "9:41 AM  ·  June 15, 2026"
  const clockEl = document.getElementById('clock');
  if (clockEl) {
    clockEl.textContent =
      now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) +
      '  ·  ' +
      now.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
  }
}

/** Boot theming: apply immediately, re-run every 30 s and on window focus. */
export function startTheme(): void {
  applyTimeOfDay();
  setInterval(applyTimeOfDay, 30_000);
  window.addEventListener('focus', applyTimeOfDay);
}
