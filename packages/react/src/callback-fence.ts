import { useEffect, useRef } from "react";

/** A previous binding cannot regain authority when an identical binding returns later. */
export function useCallbackFence(key: string): () => boolean {
  const current = useRef({ key, active: true });
  if (current.current.key !== key) current.current = { key, active: true };
  const retained = current.current;
  useEffect(() => {
    retained.active = true;
    return () => {
      retained.active = false;
    };
  }, [retained]);
  return () => current.current === retained && retained.active;
}
