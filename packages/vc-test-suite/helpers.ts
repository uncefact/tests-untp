import _ from 'lodash';

export function reportRow(title: string, name: string, fn: any) {
  it(title, async function () {
    // append test meta data to the it/test this.
    this.test.cell = {
      columnId: name,
      rowId: this.test.title,
    };
    // apply the test's this to the function that runs the test
    // eslint-disable-next-line prefer-rest-params
    await fn.apply(this, arguments);
  });
}

export function setupMatrix(implementors: string[], columnLabel: string) {
  const summaries = new Set();
  this.summary = summaries;
  // when the report sees a suite with report true it includes it
  this.report = true;
  // this tells the reporter to use the matrix.hbs template to display the results
  this.matrix = true;
  // this gives the names of the implementations that are being tested
  this.implemented = implementors;
  // this gives the names of the implementations that are not being tested
  this.notImplemented = [];
  // this will give the row label in the matrix
  this.rowLabel = 'Test Name';
  // this is the column label in the matrix
  this.columnLabel = columnLabel;
  //this is an array with items in the form {data: 'foo', detail: false, label: 'bar'}
  const reportData: Record<string, any>[] = [];
  // reportData is displayed as code examples
  this.reportData = reportData;
  // this is an array with items in the form {src: 'foo', meta: ['bar']}
  // the images will be displayed with the meta under them
  const images: Record<string, any>[] = [];
  this.images = images;
}

/**
 * Builds a URL with additional query parameters.
 * @param baseUrl - The base URL.
 * @param additionalParams - Additional query parameters as key-value pairs.
 * @returns The built URL as a string.
 * @throws {Error} If baseUrl is not a valid URL or additionalParams is not a plain object.
 */
export const buildUrl = (baseUrl: string, additionalParams: Record<string, any>): string => {
  // Validate baseUrl
  if (typeof baseUrl !== 'string' || baseUrl.trim() === '') {
    throw new Error('baseUrl must be a non-empty string.');
  }

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch (error) {
    throw new Error('baseUrl must be a valid URL, including the protocol (e.g., http:// or https://).');
  }

  // Validate additionalParams
  if (!_.isPlainObject(additionalParams)) {
    throw new Error('additionalParams must be a plain object.');
  }

  // Add additional parameters
  Object.entries(additionalParams).forEach(([key, value]) => {
    let stringValue: string;
    if (typeof value === 'object' && value !== null) {
      stringValue = JSON.stringify(value);
    } else {
      stringValue = String(value);
    }
    url.searchParams.append(key, stringValue);
  });

  return url.toString();
};

/**
 * Builds a payload by merging a base payload with additional payload.
 * @param basePayload - The base payload object.
 * @param additionalPayload - The additional payload object.
 * @returns The merged payload object.
 * @throws {Error} If either parameter is not a plain object or is null, with specific error messages for each.
 */
export const buildPayload = (
  basePayload: Record<string, any>,
  additionalPayload: Record<string, any>,
): Record<string, any> => {
  if (!_.isPlainObject(basePayload) || basePayload === null) {
    throw new Error('basePayload must be a plain object and cannot be null.');
  }

  if (!_.isPlainObject(additionalPayload) || additionalPayload === null) {
    throw new Error('additionalPayload must be a plain object and cannot be null.');
  }

  return { ...additionalPayload, ...basePayload };
};
