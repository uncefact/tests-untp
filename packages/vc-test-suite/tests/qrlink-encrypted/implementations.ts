import { request } from '../../httpService';

export const implementer = {
  name: 'QR Link Verification',
  qrLinkEncrypted: {
    url: 'https://example.com/verify',
    headers: {},
    method: 'GET',
  },
};

export const getQrLink = async (constructQr: any) => {
  try {
    const data = await request({
      method: implementer.qrLinkEncrypted.method,
      url: implementer.qrLinkEncrypted.url,
      data: constructQr,
      headers: {
        ...implementer.qrLinkEncrypted.headers,
      },
    });

    return data;
  } catch (error) {
    const e = error as Error;
    throw new Error(e.message);
  }
};
