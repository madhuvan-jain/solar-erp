// Long jobs running on screen (CSV import, backup, restore, demo data). The automatic switch to a new app version
// waits while any is running, as it does for unsaved forms.
let running = 0;

export function startBusy(): () => void {
  running++;
  let done = false;
  return () => { if (!done) { done = true; running--; } };
}

export const isBusy = () => running > 0;
