"use client";

import Image from "next/image";
import { useSyncExternalStore } from "react";
import { assetPath } from "@/lib/asset-path";
import { failedNewsImages, newsImageFailureRevision, rememberNewsImageFailure, resolveNewsImage, subscribeNewsImageFailures, type NewsImageInput } from "@/lib/news-images";
import "@/app/news/news-image.css";

export interface NewsImageProps { news: NewsImageInput; className?: string; sizes?: string; priority?: boolean }

/** A decorative, reserved-size image that cannot hide article text when all sources fail. */
export default function NewsImage({ news, className = "", sizes = "(max-width: 700px) 100vw, 33vw", priority = false }: NewsImageProps) {
  useSyncExternalStore(subscribeNewsImageFailures, newsImageFailureRevision, () => 0);
  const image = resolveNewsImage(news, failedNewsImages());
  return <div className={`news-media ${className}`.trim()} data-image-kind={image.kind}>
    {image.src && <Image key={image.src} src={image.src.startsWith("/") ? assetPath(image.src) : image.src} alt="" fill sizes={sizes} unoptimized preload={priority} loading={priority ? undefined : "lazy"} referrerPolicy="no-referrer" onError={() => { if (image.src) rememberNewsImageFailure(image.src); }} />}
    {image.kind !== "article" && <span className="news-image-classification" aria-hidden="true">분류 이미지</span>}
  </div>;
}
