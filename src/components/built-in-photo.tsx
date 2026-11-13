"use client";

import Image from "next/image";
import { useEffect, useState, type ReactNode } from "react";

export function BuiltInPhoto({ src, alt, eager, fallback }: { src: string; alt: string; eager?: boolean; fallback?: ReactNode }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!failed) return;
    function retry() {
      setAttempt((previous) => previous + 1);
      setFailed(false);
    }
    const timer = attempt === 0 ? window.setTimeout(retry, 600) : undefined;
    window.addEventListener("online", retry);
    navigator.serviceWorker?.addEventListener("controllerchange", retry);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("online", retry);
      navigator.serviceWorker?.removeEventListener("controllerchange", retry);
    };
  }, [attempt, failed]);

  if (failed) return fallback ?? null;
  const url = attempt ? `${src}?stockpact-image-retry=1` : src;
  return <Image key={attempt} src={url} alt={alt} fill unoptimized loading={eager ? "eager" : "lazy"} onError={() => setFailed(true)} />;
}
