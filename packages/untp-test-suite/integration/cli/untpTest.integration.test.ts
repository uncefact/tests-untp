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

  let credentials: ConfigContent[];
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

    describe('Validation of `schema` in the configuration file', () => {
      it('should ensure that the schema file of each credential exists', () => {
        expect(stdout).not.toBeNull();
        for (const credential of credentials) {
          expect(
            fs.existsSync(`${process.cwd()}/src/schemas/${credential.type}/${credential.version}/schema.json`),
          ).toBe(true);
        }
      });

      it('should return the content of `schema` when file is valid', () => {
        expect(stdout).not.toBeNull();
        for (const credential of credentials) {
          const data = fs.readFileSync(
            `${process.cwd()}/src/schemas/${credential.type}/${credential.version}/schema.json`,
            'utf8',
          );

          expect(data).not.toBe('');
        }
      });
    });

    describe('Validation of `dataPath` in the configuration file', () => {
      it('should ensure that the `dataPath` of each credential exists and format the JSON file', () => {
        expect(stdout).not.toBeNull();
        for (const credential of credentials) {
          expect(fs.existsSync(`${process.cwd()}/${credential.dataPath}`)).toBe(true);
          expect(credential.dataPath).toMatch(/\.json$/);
        }
      });

      it('should return the content of `dataPath` when file is valid', () => {
        expect(stdout).not.toBeNull();
        for (const credential of credentials) {
          const data = fs.readFileSync(`${process.cwd()}/${credential.dataPath}`, 'utf8');
          expect(data).not.toBe('');
        }
      });
    });
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
