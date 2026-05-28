export function xHandleFromUrl(url: string) {
  const handle = new URL(url).pathname.split("/").filter(Boolean)[0];
  if (!handle) {
    throw new Error(`Invalid X post URL: ${url}`);
  }
  return handle;
}
