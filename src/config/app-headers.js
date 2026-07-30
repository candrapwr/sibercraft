export const APP_IDENTITY_HEADERS = Object.freeze({
  "User-Agent": "Siberflow/0.1",
  "X-Client-Name": "siberflow",
  "X-Client-Version": "0.1",
  "X-App-Name": "siberflow",
});

export function withAppIdentityHeaders(headers = {}) {
  return { ...APP_IDENTITY_HEADERS, ...headers };
}
