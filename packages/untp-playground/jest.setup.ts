import '@testing-library/jest-dom';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import chai from 'chai';
import jsonld from 'jsonld'; // Import jsonld

// Expose Ajv and AjvFormats globally for untp-test-suite-mocha
(global as any).ajv2020 = Ajv2020;
(global as any).AjvFormats = addFormats;

// Expose Chai globally for untp-test-suite-mocha
(global as any).chai = chai;

// Expose jsonld globally for untp-test-suite-mocha
(global as any).jsonld = jsonld;