// Visibility is derived, never written back into the user's wide-screen preferences.
export const AUXILIARY_BREAKPOINT = 1100;
export function workspacePanels(preferences, { focused = false, width = 1440, active = 'notes' } = {}) {
  const result = { library: Boolean(preferences.library), notes: Boolean(preferences.notes), navigation: Boolean(preferences.navigation) };
  if (focused) return { library: false, notes: false, navigation: false };
  if (width <= AUXILIARY_BREAKPOINT) {
    if (active === 'none') return { library: false, notes: false, navigation: false };
    const chosen = result[active] ? active : ['notes', 'library', 'navigation'].find(key => result[key]);
    for (const key of Object.keys(result)) result[key] = key === chosen;
  }
  return result;
}
export function paneWidth(value, { min, max, fallback }) {
  return Math.min(max, Math.max(min, Number.isFinite(Number(value)) && value !== null ? Math.round(Number(value)) : fallback));
}
export function resizedPaneWidth(current, key, { min, max, step = 16 }) {
  const next = { ArrowLeft: current - step, ArrowRight: current + step, Home: min, End: max }[key];
  return next === undefined ? null : paneWidth(next, { min, max, fallback: current });
}
