/** Returns true only when FETCH_ALLOW_PRIVATE_URLS is set to the exact string `true`. */
export function readFetchAllowPrivateUrls(env: Record<string, string | undefined> = process.env): boolean {
  return env.FETCH_ALLOW_PRIVATE_URLS === 'true';
}

export const fetchAllowPrivateUrls = readFetchAllowPrivateUrls();
