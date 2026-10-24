/** Images in notes, badges and banners are stored as vault paths such as
 *  `attachments/cat.png`. The app decides how a path becomes a viewable URL. */

let resolver: (path: string) => string = (p) => p;

export function setMediaResolver(fn: (path: string) => string) {
  resolver = fn;
}

export const isImagePath = (value: string) => /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(value.trim());

/** Turns an image reference into something an <img> or CSS url() can load. */
export function mediaUrl(src: string): string {
  if (!src || /^(https?:|data:|blob:|asset:|http:\/\/asset\.localhost)/i.test(src)) return src;
  return resolver(decodeURI(src).replace(/^\.?\//, ""));
}
