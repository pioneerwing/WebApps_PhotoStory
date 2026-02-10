"use client";

import { useEffect, useMemo, useState } from "react";

const imageCache = new Map<string, string>();

type Props = Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
  alt: string;
  token?: string | null;
};

export function AuthorizedImage({ src, alt, token, ...rest }: Props) {
  // If a token is provided, we start with a placeholder to avoid an unauthenticated request (401/404)
  // that would happen immediately if we used the raw src in the img tag.
  const [resolvedSrc, setResolvedSrc] = useState(
    token
      ? "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
      : src,
  );

  const cacheKey = useMemo(() => {
    if (!token) return null;
    return `${src}|${token}`;
  }, [src, token]);

  useEffect(() => {
    if (!token) {
      setResolvedSrc(src);
    }
    // If token exists, the main effect handles it.
    // We don't want to reset to 'src' here blindly if token is present,
    // because that would trigger the unauthenticated request again.
  }, [src, token]);

  useEffect(() => {
    let cancelled = false;

    if (!token) {
      setResolvedSrc(src);
      return () => {
        cancelled = true;
      };
    }

    if (cacheKey && imageCache.has(cacheKey)) {
      const cached = imageCache.get(cacheKey);
      if (cached) {
        setResolvedSrc(cached);
      }
      return () => {
        cancelled = true;
      };
    }

    const run = async () => {
      try {
        const response = await fetch(src, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error("Failed to load image");
        }

        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        if (cacheKey) {
          imageCache.set(cacheKey, objectUrl);
        }
        if (!cancelled) {
          setResolvedSrc(objectUrl);
        }
      } catch {
        if (!cancelled) {
          setResolvedSrc(src);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [src, token, cacheKey]);

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={resolvedSrc} alt={alt} {...rest} />;
}
