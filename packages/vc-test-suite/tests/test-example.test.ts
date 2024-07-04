/* eslint-disable @typescript-eslint/no-empty-function */
import { reportRow, setupMatrix } from '../helpers';

describe('Matrix Test', function () {
  setupMatrix.call(this, ['foo'], 'Implementer');
  reportRow('should be a cell in the matrix', 'foo', async function () {});
  reportRow('should be a cell in the matrix1', 'foo', async function () {});
  reportRow('should be a cell in the matrix2', 'foo', async function () {});
});
