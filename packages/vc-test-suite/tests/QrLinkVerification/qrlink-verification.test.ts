import chai from 'chai';

import { computeHash, HashAlgorithm, decryptCredential } from '@mock-app/services';

import { reportRow, setupMatrix } from '../../helpers';
import { request } from '../../httpService';
import { isURLEncoded, parseQRLink } from './helper';
import config from '../../config';

const expect = chai.expect;

describe('QR Link Verification with encrypted data', function () {
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

    data.should.not.be.null;
    data.should.not.be.undefined;
    data.should.not.be.empty;
  });
  reportRow('Hash MUST exist and be a string', config.implementationName, function () {
    expect(parsedLink.q.payload.hash).to.be.a('string');
  });
  reportRow('Hash MUST match the credential hash', config.implementationName, async function () {
    const { data } = await request({
      url: parsedLink.q.payload.uri,
      method,
      headers,
    });
    const stringifyVC = decryptCredential({
      ...data,
      key: parsedLink.q.payload.key,
    });
    const vc = JSON.parse(stringifyVC);
    const credentialHash = computeHash(vc, HashAlgorithm.SHA256);
    expect(parsedLink.q.payload.hash).to.equal(credentialHash);
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
      ...data,
      key: parsedLink.q.payload.key,
    });

    // Assert that stringifyVC is not null, empty, or undefined
    stringifyVC.should.not.be.null;
    stringifyVC.should.not.be.undefined;
    stringifyVC.should.not.be.empty;
  });
});

describe('QR Link Verification with unencrypted data', function () {
  const { url: qrLink } = config.testSuites.QrLinkUnencrypted;
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

  reportRow('Hash MUST exist and be a string', config.implementationName, function () {
    expect(parsedLink.q.payload.hash).to.be.a('string');
  });

  reportRow('Hash MUST match the credential hash', config.implementationName, async function () {
    const { data } = await request({
      url: parsedLink.q.payload.uri,
      method: 'GET',
      headers: {},
    });

    const credentialHash = computeHash(data, HashAlgorithm.SHA256);
    expect(parsedLink.q.payload.hash).to.equal(credentialHash);
  });
});
