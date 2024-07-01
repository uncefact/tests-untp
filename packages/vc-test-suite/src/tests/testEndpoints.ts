import http from 'http';
import receiveJson from './receive-json.js';

export async function post(endpoint: string, object: any): Promise<any> {
  const postData = Buffer.from(JSON.stringify(object));

  const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const req = http.request(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': postData.length,
        Accept: 'application/json'
      }
    }, resolve);
    req.on('error', reject);
    req.end(postData);
  });

  const result = await receiveJson(res);
  return {
    ...result,
    statusCode: res.statusCode
  }
}