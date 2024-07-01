import chai from 'chai';
import { post } from '../testEndpoints.js';
import response200OK from './testData/response-200-ok.json' with {type: 'json'};
import response200Fail from './testData/response-200-fail.json' with {type: 'json'};
import responseDocumentsOk from './testData/response-documents-ok.json' with {type: 'json'};

const should = chai.should();

describe('RenderTemplate', async () => {
  const renderTemplateEndpoint = 'http://localhost:3332/agent/renderCredential';

  it('Should response 200 status code', async () => {
    const { input, expected } = response200OK;

    const result = await post(renderTemplateEndpoint, input);

    should.equal(result.statusCode, expected);
  });

  it('Should not response 200 status code', async () => {
    const { input, expected } = response200Fail;

    const result = await post(renderTemplateEndpoint, input);

    should.not.equal(result.statusCode, expected);
  });

  it('Should response contains "documents" array and valid item', async () => {
    const { input, expected } = responseDocumentsOk;

    const result = await post(renderTemplateEndpoint, input);

    should.equal(JSON.stringify(result), JSON.stringify(expected));
  });

  it('Should response the "type" field within the "documents" array is "RenderTemplate2024"', async () => {
    const { input, expected } = responseDocumentsOk;

    const result = await post(renderTemplateEndpoint, input);

    should.equal(JSON.stringify(result), JSON.stringify(expected));
  });
});