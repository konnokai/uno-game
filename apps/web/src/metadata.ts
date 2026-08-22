export interface PageMetadata {
  title: string;
  description: string;
  url: string;
  image: string;
  imageAlt: string;
}

const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/u;
const LOBBY_ROOM_PATH_PATTERN = /^\/lobby\/([A-HJ-NP-Z2-9]{6})\/?$/u;
const DEFAULT_TITLE = "UNO｜即時多人卡牌遊戲";
const DEFAULT_DESCRIPTION = "免註冊，輸入暱稱即可加入，和 2–8 位玩家即時遊玩經典 UNO。";
const IMAGE_ALT = "UNO 即時多人卡牌遊戲";

/** Builds share metadata from query or lobby invitation URLs before React runs. */
export function getPageMetadata(url: URL): PageMetadata {
  const pathRoomCode = url.pathname.match(LOBBY_ROOM_PATH_PATTERN)?.[1];
  const queryRoomCode = url.searchParams.get("room")?.trim().toUpperCase();
  const invitationRoomCode = [pathRoomCode, queryRoomCode]
    .find((roomCode) => roomCode !== undefined && ROOM_CODE_PATTERN.test(roomCode)) ?? null;
  const shareUrl = new URL(url.origin + url.pathname);

  if (invitationRoomCode && pathRoomCode !== invitationRoomCode) {
    shareUrl.searchParams.set("room", invitationRoomCode);
  }

  return {
    title: invitationRoomCode ? `房主邀請你遊玩 UNO｜房號 ${invitationRoomCode}` : DEFAULT_TITLE,
    description: invitationRoomCode
      ? `加入房間 ${invitationRoomCode}，和朋友一起遊玩即時多人 UNO。輸入暱稱即可開始。`
      : DEFAULT_DESCRIPTION,
    url: shareUrl.href,
    image: new URL("/og-image.png", url.origin).href,
    imageAlt: IMAGE_ALT,
  };
}

function setMetaContent(attribute: "name" | "property", key: string, value: string): void {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.content = value;
}

/** Applies the same metadata in the browser so Vite development and client navigation stay shareable. */
export function applyPageMetadata(metadata: PageMetadata): void {
  document.title = metadata.title;
  setMetaContent("name", "description", metadata.description);
  setMetaContent("property", "og:title", metadata.title);
  setMetaContent("property", "og:description", metadata.description);
  setMetaContent("property", "og:url", metadata.url);
  setMetaContent("property", "og:image", metadata.image);
  setMetaContent("property", "og:image:alt", metadata.imageAlt);
  setMetaContent("name", "twitter:title", metadata.title);
  setMetaContent("name", "twitter:description", metadata.description);
  setMetaContent("name", "twitter:image", metadata.image);

  const canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (canonical) canonical.href = metadata.url;
}
