import { toast } from "sonner";

/**
 * Ask the server to hot-reload the file-server watchers after a roots/rules
 * change. Posts to the dedicated API route (which imports reloadWatchers()).
 */
export async function reloadWatchers(opts?: { silent?: boolean }) {
  try {
    const r = await fetch("/api/settings/reload-watchers", { method: "POST" });
    if (!r.ok) {
      if (!opts?.silent) toast.error("Saved, but watchers could not be reloaded");
      return false;
    }
    if (!opts?.silent) toast.success("Watchers reloaded", { description: "Changes are live" });
    return true;
  } catch {
    if (!opts?.silent) toast.error("Saved, but watchers could not be reloaded");
    return false;
  }
}
