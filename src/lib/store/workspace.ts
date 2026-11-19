// Device mode can hold several separate businesses ("workspaces") in one browser. Each keeps its own
// users, records, numbering and recovery code under its own storage prefix. The first business on a
// device uses the original keys (ss1:…), so data from before this existed stays exactly where it was.
export const ROOT = 'ss1:';
export const MAIN = 'main';

let current = MAIN;

export const prefixOf = (id: string) => (id === MAIN ? ROOT : `${ROOT}w:${id}:`);

/** The business the person on this device is signed in to. */
export const currentWorkspace = () => current;
export const workspacePrefix = () => prefixOf(current);
export function useWorkspace(id: string) { current = id || MAIN; }
