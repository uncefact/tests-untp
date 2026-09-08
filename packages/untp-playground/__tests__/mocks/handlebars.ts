// Jest cannot run Next's raw-loader, so the `.hbs` import resolves here (jest.config.js). Export
// the real template's text so the HTML tests render what production renders.
import { readFileSync } from 'fs';
import { resolve } from 'path';

module.exports = readFileSync(
  resolve(__dirname, '../../src/lib/templates/untp-conformance-report-template.hbs'),
  'utf8',
);
