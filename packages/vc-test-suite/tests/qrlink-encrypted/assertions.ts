import * as chai from 'chai';
import { parseQRLink } from './helper';

const should = chai.should();

export const testConstructQRLink = (qrLink: string) => {
  should.exist(qrLink, 'expected QR Link to exist');
  qrLink.should.be.a('string');
  const parseData = parseQRLink(qrLink);
  should.exist(parseData.verify_app_address, 'expected verify app address to exist');
  parseData.verify_app_address.should.be.a('string');
  should.exist(parseData.q.payload, 'expected payload to exist');
  parseData.q.payload.should.be.an('object');
  should.exist(parseData.q.payload.uri, 'expected uri to exist');
  parseData.q.payload.uri.should.be.a('string');
  should.exist(parseData.q.payload.hash, 'expected hash to exist');
  parseData.q.payload.hash.should.be.a('string');
};
