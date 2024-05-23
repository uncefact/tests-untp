import { mappingImportedData } from '../import.service';
import { IImportedData } from '../types';

describe('mappingImportedData', () => {
  it('Should throw an error when importedData is empty', () => {
    const importedData: IImportedData[] = [];
    const parameters = { requiredFields: ['field1'] };

    expect(() => mappingImportedData(importedData, parameters)).toThrow('Import data or required fields are missing');
  });

  it('Should throw an error when parameters.requiredFields is undefined', () => {
    const importedData = [{ label: 'label', value: 'data' }];
    const parameters = {};

    expect(() => mappingImportedData(importedData, parameters)).toThrow('Import data or required fields are missing');
  });

  it('Should throw an error when parameters is undefined', () => {
    const importedData = [{ label: 'label', value: 'data' }];
    const parameters = undefined;

    expect(() => mappingImportedData(importedData, parameters)).toThrow('Import data or required fields are missing');
  });

  it('Should throw an error when importedData is not an array', () => {
    const importedData = 1 as any;
    const parameters = { requiredFields: ['field1'] };

    expect(() => mappingImportedData(importedData, parameters)).toThrow('Import data or required fields are missing');
  });

  it('Should return an object with a \'data\' property when importedData and parameters.requiredFields are provided', () => {
    const importedData = [{ label: 'label', value: 'data' }];
    const parameters = { requiredFields: ['field1'] };

    const result = mappingImportedData(importedData, parameters);

    expect(result).toEqual({ data: { field1: ['label'] } });
  });

  it('Should handle importedData with multiple items', () => {
    const importedData = [
      { label: 'label1', value: 'data1' },
      { label: 'label2', value: 'data2' },
    ];
    const parameters = { requiredFields: ['field1'] };

    const result = mappingImportedData(importedData, parameters);

    expect(result).toEqual({ data: { field1: ['label1', 'label2'] } });
  });

  it('Should handle importedData with multiple required Fields', () => {
    const importedData = [
      { label: 'label1', value: 'data1' },
      { label: 'label2', value: 'data2' },
    ];
    const parameters = { requiredFields: ['field1', 'field2'] };

    const result = mappingImportedData(importedData, parameters);

    expect(result).toEqual({ data: { field1: { field2: ['label1', 'label2']} } });
  });
});
