describe("CLI 'untp test' Commands", () => {
  it('should display default config when user do not provide any config', () => {});
  it('should display the config provided by the user', () => {});

  describe('check content of the config file', () => {
    it('should display an error message when the config file is empty', () => {});
    it('should display an error message when the config file is not in JSON format', () => {});
    it('should display an error message when the config file does not contain the type', () => {});
    it('should display an error message when the config file does not contain the version', () => {});
    it('should display an error message when the config file does not contain the dataPath', () => {});
    it('should display an error message when the config file does not contain the type and the version', () => {});
    it('should display an error message when the config file does not contain the type and the dataPath', () => {});
    it('should display an error message when the config file does not contain the version and the dataPath', () => {});
    it('should return the config content when the config file contains the type, the version and the dataPath', () => {});
  });

  describe('check dataPath in the config file', () => {
    it('should display an error message when the dataPath is not a valid path', () => {});
    it('should display an error message when the dataPath does not exist', () => {});
    it('should display an error message when the dataPath is not a JSON file', () => {});
    it('should return the data when the dataPath is a valid path', () => {});
  });

  describe('check schema file', () => {
    it('should display an error message when the schema does not exist', () => {});
    it('should display an error message when the schema does not contain version', () => {});
    it('should display an error message when the schema does not contain content', () => {});
    it('should return the schema when the schema is a valid schema', () => {});
  });

  describe('check data by schema', () => {
    it('should display an error message when the data does not match the schema', () => {});
    it('should display warning when the data lacks of information', () => {});
    it('should return the data when the data matches the schema', () => {});
  });

  describe('generate test suite result by template', () => {
    it('should show PASS in report when all data validate', () => {});
    it('should show FAIL in report when all data not validate', () => {});
    it('should show WARN in report when a few data lacks of information and the result does not FAIL', () => {});
    it('should show FAIL in the report when the result contain WARN, FAIL and PASS', () => {});
    it('should display name, version and status of the test suite in table', () => {});
  });
});
