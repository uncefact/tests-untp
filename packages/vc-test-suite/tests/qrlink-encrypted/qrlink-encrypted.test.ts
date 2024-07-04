import assert from 'node:assert/strict';
import { decryptString } from '@govtechsg/oa-encryption';
import { getAndParseQrLink, isURLEncoded, parseQRLink } from './helper';
import { reportRow, setupMatrix } from '../../helpers';
import { getQrLink, implementer } from './implementations';
import { request } from '../../httpService';

describe('QR Link Verification', function () {
  setupMatrix.call(this, implementer.name, implementer.name);

  reportRow('QR link MUST be URL encoded', 'Qr link', async function () {
    const qrLink = await getQrLink(require('./testData/construct-qrlink-ok.json'));
    const data = isURLEncoded(qrLink);
    assert.strictEqual(data, true);
  });

  reportRow('Verification page link MUST exist and be a string', 'Qr link', async function () {
    const qrLink = await getQrLink(require('./testData/construct-qrlink-ok.json'));
    const res = parseQRLink(qrLink);
    assert.strictEqual(typeof res.verify_app_address, 'string');
  });

  reportRow('Payload MUST exist and be an object', 'Qr link', async function () {
    const res = await getAndParseQrLink('./testData/construct-qrlink-ok.json');
    assert.strictEqual(typeof res.q.payload, 'object');
  });

  reportRow('URI MUST exist and be a string', 'Qr link', async function () {
    const res = await getAndParseQrLink('./testData/construct-qrlink-ok.json');
    assert.strictEqual(typeof res.q.payload.uri, 'string');

    // negative test
    await assert.rejects(getQrLink(require('./testData/construct-qrlink-no-credential-fail.json')));
  });

  reportRow('URI MUST be resolvable', 'Qr link', async function () {
    const res = await getAndParseQrLink('./testData/construct-qrlink-ok.json');
    const uriResponse = await request({
      method: 'GET',
      url: res.q.payload.uri,
    });

    assert.strictEqual(typeof uriResponse, 'object');
  });

  reportRow('Hash MUST exist and be a string', 'Qr link', async function () {
    // positive test
    const res = await getAndParseQrLink('./testData/construct-qrlink-ok.json');
    assert.strictEqual(typeof res.q.payload.hash, 'string');

    // negative test
    await assert.rejects(getQrLink(require('./testData/construct-qrlink-no-hash-fail.json')));
  });

  // reportRow('Hash MUST match the credential hash', 'Qr link', async function () {
  //   const res = await getAndParseQrLink('./testData/construct-qrlink-ok.json');
  //   const uriResponse = await request({
  //     method: 'GET',
  //     url: res.q.payload.uri,
  //   });

  //   const stringifyVC = decryptString({
  //     ...uriResponse.document,
  //     key: res.q.payload.key,
  //     type: 'OPEN-ATTESTATION-TYPE-1',
  //   });
  //   const vc = JSON.parse(stringifyVC);
  //   const credentialHash = computeEntryHash(vc);

  //   assert.strictEqual(res.q.payload.hash, credentialHash);
  // });

  reportRow('Key exist and be a string', 'Qr link', async function () {
    const res = await getAndParseQrLink('./testData/construct-qrlink-no-key-optional-ok.json');
    assert.strictEqual(typeof res.q.payload.key, 'string');
  });

  reportRow('Key MUST decrypt the encrypted credential', 'Qr link', async function () {
    const res = await getAndParseQrLink('./testData/construct-qrlink-ok.json');
    const uriResponse = await request({
      method: 'GET',
      url: res.q.payload.uri,
    });

    const stringifyVC = decryptString({
      ...uriResponse.document,
      key: res.q.payload.key,
      type: 'OPEN-ATTESTATION-TYPE-1',
    });

    const vc = JSON.parse(stringifyVC);
    assert.strictEqual(typeof vc, 'object');
  });
});
