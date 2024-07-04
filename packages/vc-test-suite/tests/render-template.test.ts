/* eslint-disable @typescript-eslint/no-empty-function */
import assert from 'assert';
import chai from 'chai';
import { reportRow, setupMatrix } from '../helpers';
import { request } from '../httpService';

chai.should();
const renderTemplateEndpoint = 'http://localhost:3332/agent/renderCredential';

describe('RenderTemplate2024', function () {
  setupMatrix.call(this, 'Result', 'Implementer');

  reportRow(
    'should verify that each item in the documents array that is valid', 'Result',
    async () => {
      // Import the input data for the test from the specified JSON file.
      const input = require('./input/render-test-suite/valid-request-payload-ok.json');

      // Send the input data to the service to get the rendered document response.
      const result = await request({
        method: 'POST',
        url: renderTemplateEndpoint,
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

  reportRow('should verify that each item in the documents array has a media query style when both mediaType and mediaQuery are provided', 'Result', async () => {
    // Import the input data for the test from the specified JSON file.
    const input = require('./input/render-test-suite/has-mediaType-and-mediaQuery-ok.json');

    // Send the input data to the service to get the rendered document response.
    const result = await request({
      method: 'POST',
      url: renderTemplateEndpoint,
      data: input,
    });

    result.should.eql({
      documents: [
        {
          type: "RenderTemplate2024",
          renderedTemplate: "PHN0eWxlPkBtZWRpYSAobWluLXdpZHRoOiAxMDI0cHgpIHsudGl0bGUge2ZvbnQtd2VpZ2h0OiBib2xkfTwvc3R5bGU+PHA+SmFuZSBEb2U8L3A+",
        },
      ],
    });
  });

  reportRow("should verify that the 'name' field, if present, is a non-empty string", 'Result', async () => {
    // Import the input data for the test from the specified JSON file.
    const input = require('./input/render-test-suite/has-name-field-ok.json');

    // Send the input data to the service to get the rendered document response.
    const result = await request({
      method: 'POST',
      url: renderTemplateEndpoint,
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

  reportRow(
    "should verify that the 'style' tag is not included in document items when 'mediaQuery' is not provided",
    'Result',
    async () => {
      // Import the input data for the test from the specified JSON file.
      const input = require('./input/render-test-suite/no-mediaQuery-in-renderMethod-ok.json');

      // Send the input data to the service to get the rendered document response.
      const result = await request({
        method: 'POST',
        url: renderTemplateEndpoint,
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
    "should verify that the 'style' tag is not included in document items when 'mediaQuery' is not provided in context",
    'Result',
    async () => {
      // Import the input data for the test from the specified JSON file.
      const input = require('./input/render-test-suite/no-mediaQuery-in-context-ok.json');

      // Send the input data to the service to get the rendered document response.
      const result = await request({
        method: 'POST',
        url: renderTemplateEndpoint,
        data: input,
      });

      result.should.eql({
        documents: [
          {
            type: "RenderTemplate2024",
            renderedTemplate: "PHA+SmFuZSBEb2U8L3A+",
          },
        ],
      });
    },
  );

  reportRow(
    'should verify that each item in the documents array remains valid when the request payload contains additional properties',
    'Result',
    async () => {
      // Import the input data for the test from the specified JSON file.
      const input = require('./input/render-test-suite/additional-properties-ok.json');

      // Send the input data to the service to get the rendered document response.
      const result = await request({
        method: 'POST',
        url: renderTemplateEndpoint,
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
    'Result',
    async () => {
      // Import the input data for the test from the specified JSON file.
      const input = require('./input/render-test-suite/missing-@context-fail.json');

      // Send the input data to the service and expect it to fail.
      await assert.rejects(request({
        method: 'POST',
        url: renderTemplateEndpoint,
        data: input,
      }));
    },
  );

  reportRow(
    "should verify that the response fails when the request payload is missing 'renderMethod'",
    'Result',
    async () => {
      // Import the input data for the test from the specified JSON file.
      const input = require('./input/render-test-suite/missing-renderMethod-fail.json');

      // Send the input data to the service and expect it to fail.
      await assert.rejects(request({
        method: 'POST',
        url: renderTemplateEndpoint,
        data: input,
      }));
    },
  );

  reportRow(
    "should verify that the response fails when the request payload contains an invalid '@context' value",
    'Result',
    async () => {
      // Import the input data for the test from the specified JSON file.
      const input = require('./input/render-test-suite/invalid-@context-fail.json');

      // Send the input data to the service and expect it to fail.
      await assert.rejects(request({
        method: 'POST',
        url: renderTemplateEndpoint,
        data: input,
      }));
    },
  );

  reportRow(
    "should verify that the response fails when the request payload is missing the 'credential' property",
    'Result',
    async () => {
      // Import the input data for the test from the specified JSON file.
      const input = require('./input/render-test-suite/missing-credential-fail.json');

      // Send the input data to the service and expect it to fail.
      await assert.rejects(request({
        method: 'POST',
        url: renderTemplateEndpoint,
        data: input,
      }));
    },
  );

  reportRow(
    'should verify that the response fails when the request payload is empty',
    'Result',
    async () => {
      // Send an empty payload to the service and expect it to fail.
      await assert.rejects(request({
        method: 'POST',
        url: renderTemplateEndpoint,
        data: {},
      }));
    },
  );
});
