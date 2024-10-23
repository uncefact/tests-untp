/* eslint-disable @typescript-eslint/no-empty-function */
import assert from 'assert';
import chai from 'chai';
import config from '../../config';
import { reportRow, setupMatrix } from '../../helpers';
import { request } from '../../httpService';

chai.should();

describe('RenderTemplate2024', function () {
  const { url, method, headers } = config.testSuites.RenderTemplate2024;

  setupMatrix.call(this, [config.implementationName], 'Implementer');

  reportRow(
    'should verify that each item in the documents array that is valid',
    config.implementationName,
    async () => {
      // Import the input data for the test from the specified JSON file.
      const input = require('./input/valid-request-payload-ok.json');

      // Send the input data to the service to get the rendered document response.
      const { data } = await request({
        method,
        url,
        data: input,
        headers,
      });

      data.should.eql({
        documents: [
          {
            type: 'RenderTemplate2024',
            renderedTemplate:
              'PHN0eWxlPkBtZWRpYSAobWluLXdpZHRoOiAxMDI0cHgpIHsubmFtZSB7Zm9udC13ZWlnaHQ6IGJvbGR9fTwvc3R5bGU+PHA+SmFuZSBEb2U8L3A+',
            name: 'template name',
          },
        ],
      });
    },
  );

  reportRow(
    "should verify that the response fails when the request payload is missing the 'credential' property",
    config.implementationName,
    async () => {
      // Import the input data for the test from the specified JSON file.
      const input = require('./input/missing-credential-fail.json');

      // Send the input data to the service and expect it to fail.
      await assert.rejects(
        request({
          method,
          url,
          data: input,
          headers,
        }),
      );
    },
  );

  reportRow(
    'should verify that the response fails when the request payload is empty',
    config.implementationName,
    async () => {
      // Send an empty payload to the service and expect it to fail.
      await assert.rejects(
        request({
          method,
          url,
          data: {},
          headers,
        }),
      );
    },
  );

  reportRow(
    "should verify that the 'name' field, if present, is a non-empty string",
    config.implementationName,
    async () => {
      // Import the input data for the test from the specified JSON file.
      const input = require('./input/name-field-empty-ok.json');

      // Send the input data to the service to get the rendered document response.
      const { data } = await request({
        method,
        url,
        data: input,
        headers,
      });

      // Verify each item in the returned documents array.
      data.documents.forEach((document) => {
        // Check that the name is a string.
        document.name.should.be.a('string');
        // Check that the name is not empty.
        document.name.trim().should.not.equal('');
      });
    },
  );

  // TODO check grammar
  reportRow("should successfully render when 'mediaQuery' is not provided", config.implementationName, async () => {
    // Import the input data for the test from the specified JSON file.
    const input = require('./input/no-mediaQuery-in-renderMethod-ok.json');

    // Send the input data to the service to get the rendered document response.
    const { data } = await request({
      method,
      url,
      data: input,
      headers,
    });

    data.should.eql({
      documents: [
        {
          type: 'RenderTemplate2024',
          renderedTemplate: 'PHA+SmFuZSBEb2U8L3A+',
        },
      ],
    });
  });

  reportRow(
    'should successfully render when the request payload contains additional properties',
    config.implementationName,
    async () => {
      // Import the input data for the test from the specified JSON file.
      const input = require('./input/additional-properties-ok.json');

      // Send the input data to the service to get the rendered document response.
      const { data } = await request({
        method,
        url,
        data: input,
        headers,
      });

      // Verify each item in the returned documents array.
      data.documents.forEach((document) => {
        // Check if the decoded renderedDocument matches the expected HTML with style.
        JSON.stringify(document).should.equal(
          JSON.stringify({
            type: 'RenderTemplate2024',
            renderedTemplate:
              'PHN0eWxlPkBtZWRpYSAobWluLXdpZHRoOiAxMDI0cHgpIHsubmFtZSB7Zm9udC13ZWlnaHQ6IGJvbGR9fTwvc3R5bGU+PHA+SmFuZSBEb2U8L3A+',
          }),
        );
      });
    },
  );

  reportRow(
    "should verify that the response fails when the request payload is missing '@context'",
    config.implementationName,
    async () => {
      // Import the input data for the test from the specified JSON file.
      const input = require('./input/missing-@context-fail.json');

      // Send the input data to the service and expect it to fail.
      await assert.rejects(
        request({
          method,
          url,
          data: input,
          headers,
        }),
      );
    },
  );

  reportRow(
    "should verify that the response fails when the request payload is missing 'renderMethod'",
    config.implementationName,
    async () => {
      // Import the input data for the test from the specified JSON file.
      const input = require('./input/missing-renderMethod-fail.json');

      // Send the input data to the service and expect it to fail.
      await assert.rejects(
        request({
          method,
          url,
          data: input,
          headers,
        }),
      );
    },
  );
});
