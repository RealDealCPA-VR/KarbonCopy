/**
 * Client-side replica of the watcher's globToRegExp (src/server/watcher.ts).
 * Kept in sync so the in-UI "glob tester" matches real watcher behavior.
 *   **  → .*        (any depth)
 *   *   → [^/\\]*   (single segment)
 *   ?   → .
 * Matching is done against a forward-slash-normalized, root-relative path.
 */
export function globToRegExp(glob: string): RegExp {
  const esc = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, " ")
    .replace(/\*/g, "[^/\\\\]*")
    .replace(/ /g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(esc, "i");
}

/** Normalize a path the same way the watcher does before testing. */
export function normalizePath(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).join("/");
}

export function globMatches(glob: string, samplePath: string): boolean {
  if (!glob || !samplePath) return false;
  try {
    return globToRegExp(glob).test(normalizePath(samplePath));
  } catch {
    return false;
  }
}
