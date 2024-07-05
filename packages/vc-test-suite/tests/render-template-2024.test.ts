/* eslint-disable @typescript-eslint/no-empty-function */
import assert from 'assert';
import chai from 'chai';
import { reportRow, setupMatrix } from '../helpers';
import { request } from '../httpService';
import * as config from '../config';

chai.should();

describe('RenderTemplate2024', function () {
  const url = config.default.testSuites.RenderTemplate2024.url;
  const method = config.default.testSuites.RenderTemplate2024.method;

  setupMatrix.call(this, [config.default.implementationName], 'Implementer');

  reportRow(
    'should verify that each item in the documents array that is valid', config.default.implementationName,
    async () => {
      // Import the input data for the test from the specified JSON file.
      const input = require('./RenderTemplate2024/input/valid-request-payload-ok.json');

      // Send the input data to the service to get the rendered document response.
      const result = await request({
        method,
        url,
        data: input,
      });

      result.should.eql({
        documents: [
          {
            type: 'RenderTemplate2024',
            renderedTemplate: 'PHN0eWxlPkBtZWRpYSAobWluLXdpZHRoOiAxMDI0cHgpIHsubmFtZSB7Zm9udC13ZWlnaHQ6IGJvbGR9fTwvc3R5bGU+PHA+SmFuZSBEb2U8L3A+',
            name: 'template name',
          },
        ],
      });
    },
  );

  reportRow(
    "should verify that the response fails when the request payload is missing the 'credential' property",
    config.default.implementationName,
    async () => {
      // Import the input data for the test from the specified JSON file.
      const input = require('./RenderTemplate2024/input/missing-credential-fail.json');

      // Send the input data to the service and expect it to fail.
      await assert.rejects(request({
        method,
        url,
        data: input,
      }));
    },
  );

  reportRow(
    'should verify that the response fails when the request payload is empty',
    config.default.implementationName,
    async () => {
      // Send an empty payload to the service and expect it to fail.
      await assert.rejects(request({
        method,
        url,
        data: {},
      }));
    },
  );

  
  reportRow("should verify that the 'name' field, if present, is a non-empty string", config.default.implementationName, async () => {
    // Import the input data for the test from the specified JSON file.
    const input = require('./RenderTemplate2024/input/name-field-empty-ok.json');

    // Send the input data to the service to get the rendered document response.
    const result = await request({
      method,
      url,
      data: input,
    });

    // Verify each item in the returned documents array.
    result.documents.forEach((document) => {
      // Check that the name is a string.
      document.name.should.be.a('string');
      // Check that the name is not empty.
      document.name.trim().should.not.equal('');
    });
  });

  // TODO check grammar
  reportRow(
    "should successfully render when 'mediaQuery' is not provided",
    config.default.implementationName,
    async () => {
      // Import the input data for the test from the specified JSON file.
      const input = require('./RenderTemplate2024/input/no-mediaQuery-in-renderMethod-ok.json');

      // Send the input data to the service to get the rendered document response.
      const result = await request({
        method,
        url,
        data: input,
      });

      result.should.eql({
        documents: [
          {
            type: 'RenderTemplate2024',
            renderedTemplate: 'PHA+SmFuZSBEb2U8L3A+',
          },
        ],
      });
    },
  );

  reportRow(
    'should successfully render when the request payload contains additional properties',
    config.default.implementationName,
    async () => {
      // Import the input data for the test from the specified JSON file.
      const input = require('./RenderTemplate2024/input/additional-properties-ok.json');

      // Send the input data to the service to get the rendered document response.
      const result = await request({
        method,
        url,
        data: input,
      });

      // Verify each item in the returned documents array.
      result.documents.forEach((document) => {
        // Check if the decoded renderedDocument matches the expected HTML with style.
        JSON.stringify(document).should.equal(JSON.stringify({
          "type": "RenderTemplate2024",
          "renderedTemplate": "PHN0eWxlPkBtZWRpYSAobWluLXdpZHRoOiAxMDI0cHgpIHsubmFtZSB7Zm9udC13ZWlnaHQ6IGJvbGR9fTwvc3R5bGU+PHA+SmFuZSBEb2U8L3A+"
        }));
      });
    },
  );

  reportRow(
    "should verify that the response fails when the request payload is missing '@context'",
    config.default.implementationName,
    async () => {
      // Import the input data for the test from the specified JSON file.
      const input = require('./RenderTemplate2024/input/missing-@context-fail.json');

      // Send the input data to the service and expect it to fail.
      await assert.rejects(request({
        method,
        url,
        data: input,
      }));
    },
  );

  reportRow(
    "should verify that the response fails when the request payload is missing 'renderMethod'",
    config.default.implementationName,
    async () => {
      // Import the input data for the test from the specified JSON file.
      const input = require('./RenderTemplate2024/input/missing-renderMethod-fail.json');

      // Send the input data to the service and expect it to fail.
      await assert.rejects(request({
        method,
        url,
        data: input,
      }));
    },
  );
});
