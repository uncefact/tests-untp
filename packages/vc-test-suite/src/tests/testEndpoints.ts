import http from 'http';
import https from 'https';
import receiveJson from './receive-json.js';

export async function post(endpoint: string, object: any): Promise<any> {
  const postData = Buffer.from(JSON.stringify(object));

  const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const req = http.request(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': postData.length,
          Accept: 'application/json',
        },
      },
      resolve,
    );
    req.on('error', reject);
    req.end(postData);
  });

  const result = await receiveJson(res);
  return {
    ...result,
    statusCode: res.statusCode,
  };
}

export async function get(url: any) {
  try {
    const res: any = await new Promise((resolve, reject) => {
      const req = https.request(
        url,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
        },
        resolve,
      );
      req.on('error', reject);
      req.end();
    });
    const result = await receiveJson(res);
    if (res.statusCode >= 400) {
      if (result != null && result.errors) {
        throw new Error(result.errors);
      }
      throw new Error(result);
    }
    if (res.statusCode >= 300) {
      throw new Error('Redirect not supported');
    }
    return result;
  } catch (e) {
    const error = e as Error;
    throw new Error(error.message);
  }
}
