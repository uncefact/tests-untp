import { decryptCredential } from '@mock-app/services';
import chai from 'chai';
import config from '../../config';
import { reportRow, setupMatrix } from '../../helpers';
import { request } from '../../httpService';
import { isURLEncoded, parseQRLink } from './helper';
import { computeHash } from '@mock-app/services';
import jwt from 'jsonwebtoken';

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

    data.should.be.an('object');
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
    const credentialHash = computeHash(vc);
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

    const vc = JSON.parse(stringifyVC);

    // Handle both JWT and regular JSON VC formats
    const vcData = vc.id?.startsWith('data:application/vc-ld+jwt,') ? jwt.decode(vc.id.split(',')[1]) : vc;

    expect(vcData).to.be.an('object');
    vcData.should.have.property('issuer');
    vcData.should.have.property('credentialSubject');
  });
});

describe('QR Link Verification with unencrypted data', function () {
  const { qrLinkUrls, method, headers } = config.testSuites.QrLink.unencrypted;

  reportRow('QR link of credential JWT MUST be URL encoded', config.implementationName, function () {
    const data = isURLEncoded(qrLinkUrls.credentialJWT);
    data.should.be.true;
  });

  reportRow('QR link of credential Object MUST be URL encoded', config.implementationName, function () {
    const data = isURLEncoded(qrLinkUrls.credentialObject);
    data.should.be.true;
  });

  describe('Validates the format of Credentials JWT', function () {
    const parsedLink = parseQRLink(qrLinkUrls.credentialJWT);
    reportRow('URI MUST be resolvable and contain JWT value', config.implementationName, async function () {
      const { data } = await request({
        url: parsedLink.q.payload.uri,
        method,
        headers,
      });

      // This expectation follows the response from the vc-api after successfully issuing a credential in EnvelopedVerifiableCredential type - https://w3c-ccg.github.io/vc-api/#issue-credential
      data.should.be.an('object');
      data['@context'].should.be.an('array');
      data.type.should.be.a('string');
      data.type.should.include('EnvelopedVerifiableCredential');
      data.id.should.be.a('string');
      data.id.should.include('data:application/vc');

      const jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/;
      data.id.split(',')[1].should.match(jwtRegex);
    });
  });

  describe('Validates the format of Credentials Object', function () {
    const parsedLink = parseQRLink(qrLinkUrls.credentialObject);
    reportRow('URI MUST be resolvable and contain JSON-LD value', config.implementationName, async function () {
      const { data } = await request({
        url: parsedLink.q.payload.uri,
        method,
        headers,
      });

      // This expectation follows the response from the vc-api after successfully issuing a credential in JSON-LD format - https://w3c-ccg.github.io/vc-api/#issue-credential
      data.should.be.an('object');
      data['@context'].should.be.an('array');
      data.type.should.be.an('array');
      data.type.should.include('VerifiableCredential');
      data.issuer.should.not.be.empty;
    });
  });
});
