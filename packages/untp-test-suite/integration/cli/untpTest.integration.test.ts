import fs from 'fs';
import { exec } from 'child_process';
import { ConfigContent } from '../../build/core/types';

describe("CLI 'untp test' Commands", () => {
  let credentialFileName: string;
  let storePath: string;

  beforeAll(() => {
    credentialFileName = 'credentials.json';
    storePath = `${process.cwd()}/${credentialFileName}`;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should exist default config when user do not provide any config', () => {
    exec('yarn untp test', (error, stdout) => {
      if (error) {
        console.error(`execSync error: ${error}`);
        return;
      }

      expect(stdout).not.toBeNull();
      expect(fs.existsSync(storePath)).toBe(true);
    });
  });

  it('should exist the config file provided by the user', () => {
    exec(`yarn untp test -c ${storePath}`, (error, stdout) => {
      if (error) {
        console.error(`execSync error: ${error}`);
        return;
      }

      expect(stdout).not.toBeNull();
      expect(fs.existsSync(storePath)).toBe(true);
    });
  });

  describe('check content of the config file', () => {
    let stdout: any;
    let credentials: ConfigContent[];
    beforeAll((done) => {
      const fileContent = fs.readFileSync(storePath, 'utf8');

      try {
        credentials = JSON.parse(fileContent).credentials;
      } catch (error) {
        expect(error).toBeNull();
      }

      exec(`yarn untp test`, (error, result) => {
        if (error) {
          console.error(`execSync error: ${error}`);
          return;
        }

        stdout = result;
        done();
      });
    });

    it('should retrieve and validate a non-empty `type` field', () => {
      expect(stdout).not.toBeNull();
      expect(fs.existsSync(storePath)).toBe(true);
      expect(credentials).toBeInstanceOf(Array);
      for (const credential of credentials) {
        expect(credential).toHaveProperty('type');
        expect(credential.type).toEqual(expect.any(String));
        expect(credential.type).not.toBe('');
      }
    });

    it('should retrieve and validate a non-empty `version` field', () => {
      expect(stdout).not.toBeNull();
      expect(fs.existsSync(storePath)).toBe(true);
      expect(credentials).toBeInstanceOf(Array);
      for (const credential of credentials) {
        expect(credential).toHaveProperty('version');
        expect(credential.version).toEqual(expect.any(String));
        expect(credential.version).not.toBe('');
      }
    });

    it('should retrieve and validate a non-empty `dataPath` field', () => {
      expect(stdout).not.toBeNull();
      expect(fs.existsSync(storePath)).toBe(true);
      expect(credentials).toBeInstanceOf(Array);
      for (const credential of credentials) {
        expect(credential).toHaveProperty('dataPath');
        expect(credential.dataPath).toEqual(expect.any(String));
        expect(credential.dataPath).not.toBe('');
      }
    });
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
