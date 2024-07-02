/* eslint-disable @typescript-eslint/no-empty-function */
import chai from 'chai';
import { reportRow, setupMatrix } from '../helpers';
import { request } from '../httpService';

chai.should();
const renderTemplateEndpoint = 'http://localhost:3332/agent/renderCredential';

describe('RenderTemplate2024', function () {
  setupMatrix.call(this, 'Result', 'Implementer');
  reportRow('should verify that each item in the documents array has a type field', 'Result', async () => {
    const input = require('./input/render-test-suite/has-type-ok.json');

    const result = await request({
      method: 'POST',
      url: renderTemplateEndpoint,
      data: input,
    });

    // Verify each item has a type field set to "RenderTemplate2024"
    result.documents.forEach(document => {
      // Check if type field exists
      document.should.have.property('type');
      // Check if the type field is exactly set to "RenderTemplate2024"
      document.type.should.equal('RenderTemplate2024');
    });
  });

  reportRow('should verify that each item in the documents array has a renderedTemplate field', 'Result', async () => {
    const input = require('./input/render-test-suite/has-renderedTemplate-ok.json');

    const result = await request({
      method: 'POST',
      url: renderTemplateEndpoint,
      data: input,
    });

    // Verify each item has a renderedTemplate field is a string
    result.documents.forEach(document => {
      // Check if type renderedTemplate exists
      document.should.have.property('renderedTemplate');
      // Check if the renderedTemplate field is a string
      document.renderedTemplate.should.be.a('string');
    });
  });
});
