import chai from 'chai';
import { createRequire } from 'module';
import { before } from 'node:test';
import { decryptString } from '@govtechsg/oa-encryption';
import { computeEntryHash } from '@veramo/utils';
import { get } from '../testEndpoints';
import { isURLEncoded, parseQRLink } from './helper';

const expect = chai.expect;
const require = createRequire(import.meta.url);

describe('QR Link Verification', function () {
  let qrLink = '';
  let parsedLink = {
    verify_app_address: '',
    q: {
      payload: {
        uri: '',
        key: '',
        hash: '',
      },
    },
  };
  before(() => {
    try {
      qrLink = require('./testData/qr-link.json').url;
      parsedLink = parseQRLink(qrLink);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`QR Link: failed to read "qr-link.json".`);
    }
  });

  it('should be URL encoded', function () {
    const data = isURLEncoded(qrLink);
    data.should.be.true;
  });

  it('should verify verify page link exists', () => {
    expect(parsedLink.verify_app_address).to.be.a('string');
  });

  describe('Test the payload property', () => {
    it('should verify that the payload property exists', () => {
      expect(parsedLink.q.payload).to.be.an('object');
    });

    describe('Test the uri property', () => {
      it('should verify that the uri property exists', () => {
        expect(parsedLink.q.payload.uri).to.be.a('string');
      });

      it('should verify that the URI is resolvable (returns a valid response)', async () => {
        const res = await get(parsedLink.q.payload.uri);
        res.should.be.an('object');
      });

      describe('Test the hash property', () => {
        it('should verify that the hash property exists', () => {
          expect(parsedLink.q.payload.hash).to.be.a('string');
        });

        it('should verify that the hash matches the credential hash', async () => {
          const res = await get(parsedLink.q.payload.uri);
          const stringifyVC = decryptString({
            ...res.document,
            key: parsedLink.q.payload.key,
            type: 'OPEN-ATTESTATION-TYPE-1',
          });
          const vc = JSON.parse(stringifyVC);
          const credentialHash = computeEntryHash(vc);

          expect(parsedLink.q.payload.hash).to.equal(credentialHash);
        });
      });

      describe('Test the key property', () => {
        it('should verify that the key is exist', () => {
          expect(parsedLink.q.payload.key).to.be.a('string');
        });

        it('should decrypt the encrypted credential', async () => {
          const res = await get(parsedLink.q.payload.uri);
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
    });
  });
});
