export function reportRow(title, name, fn) {
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

export function setupMatrix(implemented, columnLabel) {
  const summaries = new Set();
  this.summary = summaries;
  // when the report sees a suite with report true it includes it
  this.report = true;
  // this tells the reporter to use the matrix.hbs template to display the results
  this.matrix = true;
  // this gives the names of the implementations that are being tested
  this.implemented = [implemented];
  // this gives the names of the implementations that are not being tested
  this.notImplemented = [];
  // this will give the row label in the matrix
  this.rowLabel = 'Test Name';
  // this is the column label in the matrix
  this.columnLabel = columnLabel;
  //this is an array with items in the form {data: 'foo', detail: false, label: 'bar'}
  const reportData = [];
  // reportData is displayed as code examples
  this.reportData = reportData;
  // this is an array with items in the form {src: 'foo', meta: ['bar']}
  // the images will be displayed with the meta under them
  const images = [];
  this.images = images;
}
