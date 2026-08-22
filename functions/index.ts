import { getPageMetadata } from "../apps/web/src/metadata";

interface PagesContext {
  request: Request;
  next: () => Promise<Response>;
}

const metadataSelectors = [
  ["name", "description", "description"],
  ["property", "og:title", "title"],
  ["property", "og:description", "description"],
  ["property", "og:url", "url"],
  ["property", "og:image", "image"],
  ["property", "og:image:alt", "imageAlt"],
  ["name", "twitter:title", "title"],
  ["name", "twitter:description", "description"],
  ["name", "twitter:image", "image"],
] as const;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
  })[character] ?? character);
}

function replaceMetaContent(html: string, attribute: string, key: string, value: string): string {
  const selector = new RegExp(
    `(<meta\\s+[^>]*${attribute}="${key}"[^>]*content=")[^"]*(")`,
    "iu",
  );
  return html.replace(selector, `$1${escapeHtml(value)}$2`);
}

/** Rewrites static page metadata so social crawlers receive invitation copy before React runs. */
export async function onRequest({ request, next }: PagesContext): Promise<Response> {
  const response = await next();
  if (request.method !== "GET" || !response.ok || !response.headers.get("content-type")?.includes("text/html")) {
    return response;
  }

  const metadata = getPageMetadata(new URL(request.url));
  let html = await response.text();
  html = html.replace(/(<title>)[^<]*(<\/title>)/iu, `$1${escapeHtml(metadata.title)}$2`);
  for (const [attribute, key, metadataKey] of metadataSelectors) {
    html = replaceMetaContent(html, attribute, key, metadata[metadataKey]);
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("etag");
  return new Response(html, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}
