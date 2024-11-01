import { decryptCredential } from '@mock-app/services';
import chai from 'chai';
import config from '../../config';
import { reportRow, setupMatrix } from '../../helpers';
import { request } from '../../httpService';
import { isURLEncoded, parseQRLink } from './helper';

const expect = chai.expect;

describe('QR Link Verification', function () {
  const { url: qrLink, method, headers } = config.testSuites.QrLinkEncrypted;
  const parsedLink = parseQRLink(qrLink);

  setupMatrix.call(this, [config.implementationName], 'Implementer');

  reportRow('QR link MUST be URL encoded', config.implementationName, function () {
    const data = isURLEncoded(qrLink);
    data.should.be.true;
  });

  reportRow('Verification page link MUST exist and be a string', config.implementationName, function () {
    expect(parsedLink.verify_app_address).to.be.a('string');
  });

  reportRow('Payload MUST exist and be an object', config.implementationName, function () {
    expect(parsedLink.q.payload).to.be.an('object');
  });

  reportRow('URI MUST exist and be a string', config.implementationName, function () {
    expect(parsedLink.q.payload.uri).to.be.a('string');
  });

  reportRow('URI MUST be resolvable', config.implementationName, async function () {
    const { data } = await request({
      url: parsedLink.q.payload.uri,
      method,
      headers,
    });

    data.should.be.an('object');
  });

  reportRow('Hash MUST exist and be a string', config.implementationName, function () {
    expect(parsedLink.q.payload.hash).to.be.a('string');
  });

  reportRow('Hash MUST match the credential hash', config.implementationName, async function () {
    // TODO: Implement this test case with hash comparison
    // const res = await request({
    //   url: parsedLink.q.payload.uri,
    //   method: 'GET',
    //   headers,
    // });
    // const stringifyVC = decryptCredential({
    //   ...res.document,
    //   key: parsedLink.q.payload.key,
    // });
    // const vc = JSON.parse(stringifyVC);
    // const credentialHash = computeEntryHash(vc);
    // expect(parsedLink.q.payload.hash).to.equal(credentialHash);
  });

  reportRow('Key exist and be a string', config.implementationName, function () {
    expect(parsedLink.q.payload.key).to.be.a('string');
  });

  reportRow('Key MUST decrypt the encrypted credential', config.implementationName, async function () {
    const { data } = await request({
      url: parsedLink.q.payload.uri,
      method,
      headers,
    });

    const stringifyVC = decryptCredential({
      ...data.document,
      key: parsedLink.q.payload.key,
    });

    const vc = JSON.parse(stringifyVC);

    expect(vc).to.be.an('object');
    vc.should.have.property('issuer');
    vc.should.have.property('credentialStatus');
    vc.should.have.property('credentialSubject');
    vc.should.have.property('proof');
  });
});
