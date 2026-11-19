// Tracks whether a form on screen has unsaved edits, so actions outside the router
// (sign-out, opening another session) can warn before throwing them away.
let dirtyForms = 0;

export function markDirty(isDirty: boolean): () => void {
  if (!isDirty) return () => {};
  dirtyForms++;
  return () => { dirtyForms--; };
}

export function hasUnsavedChanges(): boolean {
  return dirtyForms > 0;
}
