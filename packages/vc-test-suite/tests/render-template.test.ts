/* eslint-disable @typescript-eslint/no-empty-function */
import chai from 'chai';
import { reportRow, setupMatrix } from '../helpers';
import { request } from '../httpService';

chai.should();
const renderTemplateEndpoint = 'http://localhost:3332/agent/renderCredential';

describe('RenderTemplate2024', function () {
  setupMatrix.call(this, 'Result', 'Implementer');

  reportRow('should verify that each item in the documents array has a type field', 'Result', async () => {
    const input = require('./input/render-test-suite/has-type-field.json');

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

  reportRow('should verify that each item in the documents array has a type field is set RenderTemplate2024', 'Result', async () => {
    const input = require('./input/render-test-suite/has-invalid-type-field.json');

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
    const input = require('./input/render-test-suite/has-renderedTemplate-field.json');

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

  reportRow('should verify that each item in the documents array has a mediaType field', 'Result', async () => {
    const input = require('./input/render-test-suite/has-mediaType-field.json');

    const result = await request({
      method: 'POST',
      url: renderTemplateEndpoint,
      data: input,
    });

    result.documents.forEach(document => {
      const renderedDocument: string = Buffer.from(document.renderedTemplate, 'base64').toString('utf8');
      renderedDocument.should.match(/<([A-Za-z][A-Za-z0-9]*)\b[^>]*>(.*?)<\/\1>|<([A-Za-z][A-Za-z0-9]*)\b[^>]*\/>/);
    });
  });

  reportRow('should verify that the name field, if present, is a non-empty string', 'Result', async () => {
    const input = require('./input/render-test-suite/has-name-field.json');

    const result = await request({
      method: 'POST',
      url: renderTemplateEndpoint,
      data: input,
    });

    // Verify the name field, if present, is a non-empty string
    result.documents.forEach(document => {
      if (document.hasOwnProperty('name')) {
        // Check that name is a string and is not empty
        document.name.should.be.a('string');
        document.name.trim().length.should.be.greaterThan(0);
      }
    });
  });

  reportRow('should verify that the documents array that contains the renderedTemplate is base64 encoded', 'Result', async () => {
    const input = require('./input/render-test-suite/renderedTemplate-base64.json');

    const result = await request({
      method: 'POST',
      url: renderTemplateEndpoint,
      data: input,
    });

    // Verify the name field, if present, is a non-empty string
    result.documents.forEach(document => {
      // check the renderedTemplate is base64 encoded
      document.renderedTemplate.should.match(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
    });
  });

  reportRow('should verify that the documents array contains valid rendered document after decoding the base64 string', 'Result', async () => {
    const input = require('./input/render-test-suite/renderedTemplate-base64-decoded.json');

    const result = await request({
      method: 'POST',
      url: renderTemplateEndpoint,
      data: input,
    });

    result.documents.forEach(document => {
      // check the renderedTemplate is base64 encoded
      const renderedDocument: string =  Buffer.from(document.renderedTemplate, 'base64').toString('utf8');
      renderedDocument.should.equal('<p>Test name</p>');
    });
  });

  reportRow('should verify that the document items have style tag when the "mediaQuery" is available and "mediaType" is html that are provided', 'Result', async () => {
    const input = require('./input/render-test-suite/mediaQuery-mediaType-provided.json');

    const result = await request({
      method: 'POST',
      url: renderTemplateEndpoint,
      data: input,
    });

    result.documents.forEach(document => {
      // check the renderedTemplate is base64 encoded
      const renderedDocument: string =  Buffer.from(document.renderedTemplate, 'base64').toString('utf8');
      renderedDocument.should.match(/<style\b[^>]*>([\s\S]*?)<\/style>/);
      renderedDocument.should.contains('@media (min-width: 1024px) {.name {font-weight: bold}}');
    });
  });

  reportRow('should verify that the template field or the url fields are provided', 'Result', async () => {
    const input = require('./input/render-test-suite/has-template-field.json');

    const result = await request({
      method: 'POST',
      url: renderTemplateEndpoint,
      data: input,
    });

    result.documents.forEach(document => {
      // check the renderedTemplate is base64 encoded
      const renderedDocument: string =  Buffer.from(document.renderedTemplate, 'base64').toString('utf8');
      renderedDocument.should.equal('<p>Hello World<p>');
    });
  });

  reportRow('should verify that the template hash matchs digestMultibase', 'Result', async () => {
    const input = require('./input/render-test-suite/template-hash-matchs-digestMultibase.json');

    const result = await request({
      method: 'POST',
      url: renderTemplateEndpoint,
      data: input,
    });

    result.documents.forEach(document => {
      // check the renderedTemplate is base64 encoded
      const renderedDocument: string =  Buffer.from(document.renderedTemplate, 'base64').toString('utf8');
      renderedDocument.should.equal('<p>name</p>');
    });
  });

  reportRow('should verify that the style tag not available in document item when mediaQuery does not provided', 'Result', async () => {
    const input = require('./input/render-test-suite/no-mediaQuery.json');

    const result = await request({
      method: 'POST',
      url: renderTemplateEndpoint,
      data: input,
    });

    result.documents.forEach(document => {
      // check the renderedTemplate is base64 encoded
      const renderedDocument: string =  Buffer.from(document.renderedTemplate, 'base64').toString('utf8');
      renderedDocument.should.not.match(/<style\b[^>]*>([\s\S]*?)<\/style>/);
    });
  });

  reportRow('should verify that the style tag not available in document item when mediaQuery does not provided in context', 'Result', async () => {
    const input = require('./input/render-test-suite/no-mediaQuery-in-context.json');

    const result = await request({
      method: 'POST',
      url: renderTemplateEndpoint,
      data: input,
    });

    result.documents.forEach(document => {
      const renderedDocument: string =  Buffer.from(document.renderedTemplate, 'base64').toString('utf8');
      renderedDocument.should.not.match(/<style\b[^>]*>([\s\S]*?)<\/style>/);
    });
  });

  reportRow('should verify that cannot response rendered document when request payload missing @context', 'Result', async () => {
    const input = require('./input/render-test-suite/missing-@context.json');

    try {
      await request({
        method: 'POST',
        url: renderTemplateEndpoint,
        data: input,
      });
    } catch (error: any) {
      error.response.status.should.equal(500);
      error.response.data.error.should.equal('Error expanding the verifiable credential');
    }
  });

  reportRow('should verify that cannot response rendered document when request payload missing renderMethod', 'Result', async () => {
    const input = require('./input/render-test-suite/missing-renderMethod.json');

    try {
      await request({
        method: 'POST',
        url: renderTemplateEndpoint,
        data: input,
      });
    } catch (error: any) {
      error.response.status.should.equal(500);
      error.response.data.error.should.equal('Error expanding the verifiable credential');
    }
  });

  reportRow('should verify that cannot response rendered document when request payload contains invalid "@context" values', 'Result', async () => {
    const input = require('./input/render-test-suite/invalid-@context.json');

    try {
      await request({
        method: 'POST',
        url: renderTemplateEndpoint,
        data: input,
      });
    } catch (error: any) {
      error.response.status.should.equal(500);
      error.response.data.error.should.be.a('string');
    }
  });

  reportRow('should verify that response rendered document when request payload contains additional properties', 'Result', async () => {
    const input = require('./input/render-test-suite/additional-properties.json');

    const result = await request({
      method: 'POST',
      url: renderTemplateEndpoint,
      data: input,
    });

    result.documents.forEach(document => {
      // check the renderedTemplate is base64 encoded
      const renderedDocument: string =  Buffer.from(document.renderedTemplate, 'base64').toString('utf8');
      renderedDocument.should.equal('<style>@media (min-width: 1024px) {.name {font-weight: bold}}</style><p>test</p>');
    });
  });

  reportRow('should verify that cannot response rendered document when request payload missing credential property', 'Result', async () => {
    const input = require('./input/render-test-suite/missing-credential.json');

    try {
      await request({
        method: 'POST',
        url: renderTemplateEndpoint,
        data: input,
      });
    } catch (error: any) {
      error.response.status.should.equal(500);
      error.response.data.error.should.equal('Error expanding the verifiable credential');
    }
  });

  reportRow('should verify that cannot response rendered document when request payload empty', 'Result', async () => {
    try {
      await request({
        method: 'POST',
        url: renderTemplateEndpoint,
        data: {},
      });
    } catch (error: any) {
      error.response.status.should.equal(500);
      error.response.data.error.should.equal('Error expanding the verifiable credential');
    }
  });

});
