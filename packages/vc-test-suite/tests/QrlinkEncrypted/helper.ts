export const parseQRLink = (qrcodeLink: string) => {
  const url = new URL(qrcodeLink);
  const verifyLink = new URLSearchParams(url.search);
  const decodedPayload = JSON.parse(decodeURIComponent(verifyLink.get('q') || ''));

  return {
    verify_app_address: url.origin + url.pathname,
    q: {
      payload: {
        uri: decodedPayload.payload.uri,
        key: decodedPayload.payload.key,
        hash: decodedPayload.payload.hash,
      },
    },
  };
};

export function isURLEncoded(str: string) {
  // URL encoded characters start with '%' followed by two hexadecimal digits
  return /%[0-9A-Fa-f]{2}/.test(str);
}
