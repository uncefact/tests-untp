import chai from 'chai';
import config from '../../config';
import { buildPayload, buildUrl, reportRow, setupMatrix } from '../../helpers';
import { request } from '../../httpService';
import { decryptData, generateGUID } from './helper';

const expect = chai.expect;

const storageConfig = config.testSuites.Storage;
const { url, encryptionUrl, headers, additionalParams, additionalPayload } = storageConfig;

describe('Storage Service', function () {
  setupMatrix.call(this, [config.implementationName], 'Implementer');

  reportRow('Store unencrypted credential and verify returned URI', config.implementationName, async () => {
    const payload = buildPayload(
      {
        id: generateGUID(),
        data: { test: 'Credential data' },
      },
      additionalPayload,
    );

    const response = await request({
      url: buildUrl(url, additionalParams),
      method: 'POST',
      headers: headers,
      data: payload,
    });

    expect(response.status).to.equal(201);
    expect(response.data).to.have.property('uri');
    expect(response.data.uri).to.be.a('string');

    const fetchResponse = await request({
      url: buildUrl(response.data.uri, additionalParams),
      method: 'GET',
      headers: headers,
    });

    expect(fetchResponse.status).to.equal(200);
    expect(fetchResponse.data).to.deep.equal(payload.data);
  });

  reportRow('Handle GUID collision for unencrypted endpoint', config.implementationName, async () => {
    const guid = generateGUID();
    const payload1 = buildPayload(
      {
        id: guid,
        data: { test: 'First credential' },
      },
      additionalPayload,
    );
    const payload2 = buildPayload(
      {
        id: guid,
        data: { test: 'Second credential' },
      },
      additionalPayload,
    );

    const response1 = await request({
      url: buildUrl(url, additionalParams),
      method: 'POST',
      headers: headers,
      data: payload1,
    });

    expect(response1.status).to.equal(201);

    let response2;
    try {
      response2 = await request({
        url: buildUrl(url, additionalParams),
        method: 'POST',
        headers: headers,
        data: payload2,
      });
    } catch (error: any) {
      expect(error?.response?.status).to.equal(409);
    }

    if (response2) {
      expect(response2.status).to.not.equal(201);
    }

    const fetchResponse = await request({
      url: buildUrl(response1.data.uri, additionalParams),
      method: 'GET',
      headers: headers,
    });

    expect(fetchResponse.status).to.equal(200);
    expect(fetchResponse.data).to.deep.equal(payload1.data);
  });

  reportRow('Fetch unencrypted credential with public access', config.implementationName, async () => {
    const payload = buildPayload(
      {
        id: generateGUID(),
        data: { test: 'Fetch Credential Test' },
      },
      additionalPayload,
    );

    const storeResponse = await request({
      url: buildUrl(url, additionalParams),
      method: 'POST',
      headers: headers,
      data: payload,
    });

    expect(storeResponse.status).to.equal(201);
    expect(storeResponse.data).to.have.property('uri');

    const fetchResponse = await request({
      url: buildUrl(storeResponse.data.uri, additionalParams),
      method: 'GET',
    });

    expect(fetchResponse.status).to.equal(200);
    expect(fetchResponse.data).to.deep.equal(payload.data);
  });

  reportRow('Encrypt, store, and verify data', config.implementationName, async () => {
    const payload = buildPayload(
      {
        id: generateGUID(),
        data: { test: 'Encryption Test Data' },
      },
      additionalPayload,
    );

    const response = await request({
      url: buildUrl(encryptionUrl, additionalParams),
      method: 'POST',
      headers: headers,
      data: payload,
    });

    expect(response.status).to.equal(201);
    expect(response.data).to.have.property('uri');
    expect(response.data).to.have.property('key');

    const fetchResponse = await request({
      url: buildUrl(response.data.uri, additionalParams),
      method: 'GET',
      headers: headers,
    });

    expect(fetchResponse.status).to.equal(200);
    expect(fetchResponse.data).to.have.property('cipherText');
    expect(fetchResponse.data).to.have.property('iv');
    expect(fetchResponse.data).to.have.property('tag');
    expect(fetchResponse.data).to.have.property('type');
    expect(fetchResponse.data.type).to.equal('aes-256-gcm');

    const decryptedData = decryptData(
      {
        cipherText: fetchResponse.data.cipherText,
        iv: fetchResponse.data.iv,
        tag: fetchResponse.data.tag,
      },
      response.data.key,
    );

    expect(decryptedData).to.deep.equal(payload.data);
  });

  reportRow('Fetch encrypted credential with public access', config.implementationName, async () => {
    const payload = buildPayload(
      {
        id: generateGUID(),
        data: { test: 'Fetch and Decrypt Test Data' },
      },
      additionalPayload,
    );

    const storeResponse = await request({
      url: buildUrl(encryptionUrl, additionalParams),
      method: 'POST',
      headers: headers,
      data: payload,
    });

    expect(storeResponse.status).to.equal(201);
    expect(storeResponse.data).to.have.property('uri');
    expect(storeResponse.data).to.have.property('key');

    const fetchResponse = await request({
      url: buildUrl(storeResponse.data.uri, additionalParams),
      method: 'GET',
    });

    expect(fetchResponse.status).to.equal(200);
    expect(fetchResponse.data).to.have.property('cipherText');
    expect(fetchResponse.data).to.have.property('iv');
    expect(fetchResponse.data).to.have.property('tag');
    expect(fetchResponse.data).to.have.property('type');
    expect(fetchResponse.data.type).to.equal('aes-256-gcm');

    const decryptedData = decryptData(
      {
        cipherText: fetchResponse.data.cipherText,
        iv: fetchResponse.data.iv,
        tag: fetchResponse.data.tag,
      },
      storeResponse.data.key,
    );

    expect(decryptedData).to.deep.equal(payload.data);
  });

  reportRow('Handle GUID collision for encrypted endpoint', config.implementationName, async () => {
    const guid = generateGUID();
    const payload1 = buildPayload(
      {
        id: guid,
        data: { test: 'First encrypted credential' },
      },
      additionalPayload,
    );
    const payload2 = buildPayload(
      {
        id: guid,
        data: { test: 'Second encrypted credential' },
      },
      additionalPayload,
    );

    const response1 = await request({
      url: buildUrl(encryptionUrl, additionalParams),
      method: 'POST',
      headers: headers,
      data: payload1,
    });

    expect(response1.status).to.equal(201);
    expect(response1.data).to.have.property('uri');
    expect(response1.data).to.have.property('key');

    let response2;
    try {
      response2 = await request({
        url: buildUrl(encryptionUrl, additionalParams),
        method: 'POST',
        headers: headers,
        data: payload2,
      });
    } catch (error: any) {
      expect(error?.response?.status).to.equal(409);
    }

    if (response2) {
      expect(response2.status).to.not.equal(201);
    }

    const fetchResponse = await request({
      url: buildUrl(response1.data.uri, additionalParams),
      method: 'GET',
      headers: headers,
    });

    expect(fetchResponse.status).to.equal(200);
    expect(fetchResponse.data).to.have.property('cipherText');
    expect(fetchResponse.data).to.have.property('iv');
    expect(fetchResponse.data).to.have.property('tag');
    expect(fetchResponse.data).to.have.property('type');
    expect(fetchResponse.data.type).to.equal('aes-256-gcm');

    const decryptedData = decryptData(
      {
        cipherText: fetchResponse.data.cipherText,
        iv: fetchResponse.data.iv,
        tag: fetchResponse.data.tag,
      },
      response1.data.key,
    );

    expect(decryptedData).to.deep.equal(payload1.data);
  });
});
