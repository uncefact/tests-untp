import chai from 'chai';
import { decryptString } from '@govtechsg/oa-encryption';
import { isURLEncoded, parseQRLink } from './helper';
import { request } from '../../httpService';
import { reportRow, setupMatrix } from '../../helpers';
import * as config from '../../config';

const expect = chai.expect;

describe('QR Link Verification', function () {
  const qrLink = config.default.testSuites.QrLinkEncrypted.url;
  const method = config.default.testSuites.QrLinkEncrypted.method;
  const parsedLink = parseQRLink(qrLink);

  setupMatrix.call(this, [config.default.implementationName], 'Implementer');

  reportRow('QR link MUST be URL encoded', config.default.implementationName, function () {
    const data = isURLEncoded(qrLink);
    data.should.be.true;
  });

  reportRow('Verification page link MUST exist and be a string', config.default.implementationName, function () {
    expect(parsedLink.verify_app_address).to.be.a('string');
  });

  reportRow('Payload MUST exist and be an object', config.default.implementationName, function () {
    expect(parsedLink.q.payload).to.be.an('object');
  });

  reportRow('URI MUST exist and be a string', config.default.implementationName, function () {
    expect(parsedLink.q.payload.uri).to.be.a('string');
  });

  reportRow('URI MUST be resolvable', config.default.implementationName, async function () {
    const res = await request({
      url: parsedLink.q.payload.uri,
      method,
    });

    res.should.be.an('object');
  });

  reportRow('Hash MUST exist and be a string', config.default.implementationName, function () {
    expect(parsedLink.q.payload.hash).to.be.a('string');
  });

  reportRow('Hash MUST match the credential hash', config.default.implementationName, async function () {
    // TODO: Implement this test case with hash comparison
    // const res = await request({
    //   url: parsedLink.q.payload.uri,
    //   method: 'GET',
    // });
    // const stringifyVC = decryptString({
    //   ...res.document,
    //   key: parsedLink.q.payload.key,
    //   type: 'OPEN-ATTESTATION-TYPE-1',
    // });
    // const vc = JSON.parse(stringifyVC);
    // const credentialHash = computeEntryHash(vc);
    // expect(parsedLink.q.payload.hash).to.equal(credentialHash);
  });

  reportRow('Key exist and be a string', config.default.implementationName, function () {
    expect(parsedLink.q.payload.key).to.be.a('string');
  });

  reportRow('Key MUST decrypt the encrypted credential', config.default.implementationName, async function () {
    const res = await request({
      url: parsedLink.q.payload.uri,
      method,
    });
    const stringifyVC = decryptString({
      ...res.document,
      key: parsedLink.q.payload.key,
      type: 'OPEN-ATTESTATION-TYPE-1',
    });
    const vc = JSON.parse(stringifyVC);
    expect(vc).to.be.an('object');
    vc.should.have.property('issuer');
    vc.should.have.property('credentialStatus');
    vc.should.have.property('credentialSubject');
    vc.should.have.property('proof');
  });
});
