"use client";
import { useEffect, useState } from "react";
import { cancellationVisibleUntil } from "@/lib/cancellation-visibility";
/** Anchor elapsed time to the server, never the browser's wall clock/timezone. */
export function useCancellationWindow(
  serverNow: string,
  bookings: { status: string; cancelledAt?: string | null }[],
) {
  const [elapsed, setElapsed] = useState({ serverNow, ms: 0 });
  useEffect(() => {
    const base = Date.parse(serverNow),
      start = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    function update() {
      clearTimeout(timer);
      const ms = performance.now() - start;
      setElapsed({ serverNow, ms });
      const next = bookings
        .filter((b) => b.status === "cancelled")
        .map((b) => cancellationVisibleUntil(b.cancelledAt))
        .filter((t): t is number => t !== null && t > base + ms);
      if (next.length)
        timer = setTimeout(
          update,
          Math.min(2147483647, Math.max(1, Math.min(...next) - base - ms)),
        );
    }
    update();
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [serverNow, bookings]);
  return (
    Date.parse(serverNow) + (elapsed.serverNow === serverNow ? elapsed.ms : 0)
  );
}
