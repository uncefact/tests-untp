/* eslint-disable @typescript-eslint/no-empty-function */
import chai from 'chai';
import { reportRow, setupMatrix } from '../helpers';
import { request } from '../httpService';

chai.should();
const renderTemplateEndpoint = 'http://localhost:3332/agent/renderCredential';

describe('RenderTemplate2024', function () {
  setupMatrix.call(this, 'Result', 'Implementer');

  reportRow('should verify that each item in the documents array has a \'type\' field set to \'RenderTemplate2024\'', 'Result', async () => {
    // Import the input data for the test from the specified JSON file.
    const input = require('./input/render-test-suite/has-invalid-type-field-ok.json');
  
    // Send the input data to the service to get the rendered document response.
    const result = await request({
      method: 'POST',
      url: renderTemplateEndpoint,
      data: input,
    });
  
    // Verify each item in the returned documents array.
    result.documents.forEach(document => {
      // Check if the type field exists.
      document.should.have.property('type');
      // Check if the type field is exactly set to "RenderTemplate2024".
      document.type.should.equal('RenderTemplate2024');
    });
  });
  
  reportRow('should verify that each item in the documents array has a \'renderedTemplate\' field', 'Result', async () => {
    // Import the input data for the test from the specified JSON file.
    const input = require('./input/render-test-suite/has-renderedTemplate-field-ok.json');
  
    // Send the input data to the service to get the rendered document response.
    const result = await request({
      method: 'POST',
      url: renderTemplateEndpoint,
      data: input,
    });
  
    // Verify each item in the returned documents array.
    result.documents.forEach(document => {
      // Check if the renderedTemplate field exists.
      document.should.have.property('renderedTemplate');
      // Check if the renderedTemplate field is a string.
      document.renderedTemplate.should.be.a('string');
    });
  });
  
  reportRow('should verify that each item in the documents array has a \'mediaType\' field', 'Result', async () => {
    // Import the input data for the test from the specified JSON file.
    const input = require('./input/render-test-suite/has-mediaType-field-ok.json');
  
    // Send the input data to the service to get the rendered document response.
    const result = await request({
      method: 'POST',
      url: renderTemplateEndpoint,
      data: input,
    });
  
    // Verify each item in the returned documents array.
    result.documents.forEach(document => {
      // Decode the base64-encoded renderedTemplate into a string.
      const renderedDocument = Buffer.from(document.renderedTemplate, 'base64').toString('utf8');
      // Check if the renderedDocument contains valid HTML tags.
      renderedDocument.should.match(/<([A-Za-z][A-Za-z0-9]*)\b[^>]*>(.*?)<\/\1>|<([A-Za-z][A-Za-z0-9]*)\b[^>]*\/>/);
    });
  });
  
  reportRow('should verify that the \'name\' field, if present, is a non-empty string', 'Result', async () => {
    // Import the input data for the test from the specified JSON file.
    const input = require('./input/render-test-suite/has-name-field-ok.json');
  
    // Send the input data to the service to get the rendered document response.
    const result = await request({
      method: 'POST',
      url: renderTemplateEndpoint,
      data: input,
    });
  
    // Verify each item in the returned documents array.
    result.documents.forEach(document => {
      // Check if the name field exists.
      if (document.hasOwnProperty('name')) {
        // Check that the name is a string.
        document.name.should.be.a('string');
        // Check that the name is not empty after trimming whitespace.
        document.name.trim().length.should.be.greaterThan(0);
      }
    });
  });
  
  reportRow('should verify that the \'documents\' array contains a \'renderedTemplate\' that is Base64 encoded', 'Result', async () => {
    // Import the input data for the test from the specified JSON file.
    const input = require('./input/render-test-suite/renderedTemplate-base64-ok.json');
  
    // Send the input data to the service to get the rendered document response.
    const result = await request({
      method: 'POST',
      url: renderTemplateEndpoint,
      data: input,
    });
  
    // Verify each item in the returned documents array.
    result.documents.forEach(document => {
      // Check if the renderedTemplate field is Base64 encoded.
      document.renderedTemplate.should.match(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
    });
  });
  
  reportRow('should verify that the \'documents\' array contains a valid rendered document after decoding the Base64 string', 'Result', async () => {
    // Import the input data for the test from the specified JSON file.
    const input = require('./input/render-test-suite/renderedTemplate-base64-decoded-ok.json');
  
    // Send the input data to the service to get the rendered document response.
    const result = await request({
      method: 'POST',
      url: renderTemplateEndpoint,
      data: input,
    });
  
    // Verify each item in the returned documents array.
    result.documents.forEach(document => {
      // Decode the base64-encoded renderedTemplate into a string.
      const renderedDocument = Buffer.from(document.renderedTemplate, 'base64').toString('utf8');
      // Check if the decoded renderedDocument matches the expected HTML.
      renderedDocument.should.equal('<p>Test name</p>');
    });
  });
  
  reportRow('should verify that document items have a \'style\' tag when \'mediaQuery\' is available and \'mediaType\' is \'html\'', 'Result', async () => {
    // Import the input data for the test from the specified JSON file.
    const input = require('./input/render-test-suite/mediaQuery-mediaType-provided-ok.json');
  
    // Send the input data to the service to get the rendered document response.
    const result = await request({
      method: 'POST',
      url: renderTemplateEndpoint,
      data: input,
    });
  
    // Verify each item in the returned documents array.
    result.documents.forEach(document => {
      // Decode the base64-encoded renderedTemplate into a string.
      const renderedDocument = Buffer.from(document.renderedTemplate, 'base64').toString('utf8');
      // Check if the renderedDocument contains a style tag.
      renderedDocument.should.match(/<style\b[^>]*>([\s\S]*?)<\/style>/);
      // Verify the content of the style tag includes the specified media query.
      renderedDocument.should.contains('@media (min-width: 1024px) {.name {font-weight: bold}}');
    });
  });
  
  reportRow('should verify that either the \'template\' field or the \'url\' field is provided', 'Result', async () => {
    // Import the input data for the test from the specified JSON file.
    const input = require('./input/render-test-suite/has-template-field-ok.json');
  
    // Send the input data to the service to get the rendered document response.
    const result = await request({
      method: 'POST',
      url: renderTemplateEndpoint,
      data: input,
    });
  
    // Verify each item in the returned documents array.
    result.documents.forEach(document => {
      // Decode the base64-encoded renderedTemplate into a string.
      const renderedDocument = Buffer.from(document.renderedTemplate, 'base64').toString('utf8');
      // Check if the decoded renderedDocument matches the expected HTML.
      renderedDocument.should.equal('<p>Hello World<p>');
    });
  });
  
  reportRow('should verify that the \'template\' hash matches the \'digestMultibase\'', 'Result', async () => {
    // Import the input data for the test from the specified JSON file.
    const input = require('./input/render-test-suite/template-hash-matchs-digestMultibase-ok.json');
  
    // Send the input data to the service to get the rendered document response.
    const result = await request({
      method: 'POST',
      url: renderTemplateEndpoint,
      data: input,
    });
  
    // Verify each item in the returned documents array.
    result.documents.forEach(document => {
      // Decode the base64-encoded renderedTemplate into a string.
      const renderedDocument = Buffer.from(document.renderedTemplate, 'base64').toString('utf8');
      // Check if the decoded renderedDocument matches the expected HTML.
      renderedDocument.should.equal('<p>name</p>');
    });
  });
  
  reportRow('should verify that the \'style\' tag is not available in document items when \'mediaQuery\' is not provided', 'Result', async () => {
    // Import the input data for the test from the specified JSON file.
    const input = require('./input/render-test-suite/no-mediaQuery-ok.json');
  
    // Send the input data to the service to get the rendered document response.
    const result = await request({
      method: 'POST',
      url: renderTemplateEndpoint,
      data: input,
    });
  
    // Verify each item in the returned documents array.
    result.documents.forEach(document => {
      // Decode the base64-encoded renderedTemplate into a string.
      const renderedDocument = Buffer.from(document.renderedTemplate, 'base64').toString('utf8');
      // Check if the renderedDocument does not contain a style tag.
      renderedDocument.should.not.match(/<style\b[^>]*>([\s\S]*?)<\/style>/);
    });
  });

  reportRow('should verify that the \'style\' tag is not available in document items when \'mediaQuery\' is not provided in context', 'Result', async () => {
    // Import the input data for the test from the specified JSON file.
    const input = require('./input/render-test-suite/no-mediaQuery-in-context-ok.json');
  
    // Send the input data to the service to get the rendered document response.
    const result = await request({
      method: 'POST',
      url: renderTemplateEndpoint,
      data: input,
    });
  
    // Verify each item in the returned documents array.
    result.documents.forEach(document => {
      // Decode the base64-encoded renderedTemplate into a string.
      const renderedDocument = Buffer.from(document.renderedTemplate, 'base64').toString('utf8');
      // Check if the renderedDocument does not contain a style tag.
      renderedDocument.should.not.match(/<style\b[^>]*>([\s\S]*?)<\/style>/);
    });
  });
  
  reportRow('should verify that the rendered document is not returned when the request payload is missing \'@context\'', 'Result', async () => {
    // Import the input data for the test from the specified JSON file.
    const input = require('./input/render-test-suite/missing-@context-fail.json');
  
    // Send the input data to the service and expect it to fail.
    try {
      await request({
        method: 'POST',
        url: renderTemplateEndpoint,
        data: input,
      });
    } catch (error: any) {
      // Verify the error status is 500 (Internal Server Error).
      error.response.status.should.equal(500);
      // Verify the error message matches the expected error.
      error.response.data.error.should.equal('Error expanding the verifiable credential');
    }
  });
  
  reportRow('should verify that the rendered document is not returned when the request payload is missing \'renderMethod\'', 'Result', async () => {
    // Import the input data for the test from the specified JSON file.
    const input = require('./input/render-test-suite/missing-renderMethod-fail.json');
  
    // Send the input data to the service and expect it to fail.
    try {
      await request({
        method: 'POST',
        url: renderTemplateEndpoint,
        data: input,
      });
    } catch (error: any) {
      // Verify the error status is 500 (Internal Server Error).
      error.response.status.should.equal(500);
      // Verify the error message matches the expected error.
      error.response.data.error.should.equal('Error expanding the verifiable credential');
    }
  });
  
  reportRow('should verify that the rendered document is not returned when the request payload contains invalid \'@context\' values', 'Result', async () => {
    // Import the input data for the test from the specified JSON file.
    const input = require('./input/render-test-suite/invalid-@context-fail.json');
  
    // Send the input data to the service and expect it to fail.
    try {
      await request({
        method: 'POST',
        url: renderTemplateEndpoint,
        data: input,
      });
    } catch (error: any) {
      // Verify the error status is 500 (Internal Server Error).
      error.response.status.should.equal(500);
      // Verify the error message is a string indicating the error.
      error.response.data.error.should.be.a('string');
    }
  });
  
  reportRow('should verify that the rendered document is returned when the request payload contains additional properties', 'Result', async () => {
    // Import the input data for the test from the specified JSON file.
    const input = require('./input/render-test-suite/additional-properties-ok.json');
  
    // Send the input data to the service to get the rendered document response.
    const result = await request({
      method: 'POST',
      url: renderTemplateEndpoint,
      data: input,
    });
  
    // Verify each item in the returned documents array.
    result.documents.forEach(document => {
      // Decode the base64-encoded renderedTemplate into a string.
      const renderedDocument = Buffer.from(document.renderedTemplate, 'base64').toString('utf8');
      // Check if the decoded renderedDocument matches the expected HTML with style.
      renderedDocument.should.equal('<style>@media (min-width: 1024px) {.name {font-weight: bold}}</style><p>test</p>');
    });
  });
  
  reportRow('should verify that the rendered document is not returned when the request payload is missing the \'credential\' property', 'Result', async () => {
    // Import the input data for the test from the specified JSON file.
    const input = require('./input/render-test-suite/missing-credential-fail.json');
  
    // Send the input data to the service and expect it to fail.
    try {
      await request({
        method: 'POST',
        url: renderTemplateEndpoint,
        data: input,
      });
    } catch (error: any) {
      // Verify the error status is 500 (Internal Server Error).
      error.response.status.should.equal(500);
      // Verify the error message matches the expected error.
      error.response.data.error.should.equal('Error expanding the verifiable credential');
    }
  });
  
  reportRow('should verify that the rendered document is not returned when the request payload is empty', 'Result', async () => {
    // Send an empty payload to the service and expect it to fail.
    try {
      await request({
        method: 'POST',
        url: renderTemplateEndpoint,
        data: {},
      });
    } catch (error: any) {
      // Verify the error status is 500 (Internal Server Error).
      error.response.status.should.equal(500);
      // Verify the error message matches the expected error.
      error.response.data.error.should.equal('Error expanding the verifiable credential');
    }
  });

});
