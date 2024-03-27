import fs from 'fs';
import { exec } from 'child_process';
import { ConfigContent } from '../../build/core/types';

describe("CLI 'untp test' Commands", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('process test runner and final report return PASS', () => {
    let credentialFileName: string;
    let storePath: string;
    let stdout: any;
    let credentials: ConfigContent[];

    const mockPath = `${process.cwd()}/integration/cli/mock/untpTestPass`;
    beforeAll((done) => {
      credentialFileName = 'credentialsExample.json';
      storePath = `${mockPath}/${credentialFileName}`;
      const fileContent = fs.readFileSync(storePath, 'utf8');

      try {
        credentials = JSON.parse(fileContent).credentials;
      } catch (error) {
        expect(error).toBeNull();
      }

      exec(`yarn untp test -c ${storePath}`, (error, result) => {
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

    describe('generate test suite result by template', () => {
      it('should show PASS in report when all data validate', () => {
        expect(stdout).toMatch(/PASS/);
        expect(stdout).toContain('Your credentials are UNTP compliant');
      });
    });
  });

  describe('process test runner and final report return FAIL', () => {
    let credentialFileName: string;
    let storePath: string;
    let stdout: any;
    let credentials: ConfigContent[];

    const mockPath = `${process.cwd()}/integration/cli/mock/untpTestFail`;
    beforeAll((done) => {
      credentialFileName = 'credentialsExample.json';
      storePath = `${mockPath}/${credentialFileName}`;
      const fileContent = fs.readFileSync(storePath, 'utf8');

      try {
        credentials = JSON.parse(fileContent).credentials;
      } catch (error) {
        expect(error).toBeNull();
      }

      exec(`yarn untp test -c ${storePath}`, (error, result) => {
        if (error) {
          console.error(`execSync error: ${error}`);
          return;
        }

        stdout = result;
        done();
      });
    });

    it('should show the certification in objectEvent data is object ', () => {
      // get only data path of object event
      const data = fs.readFileSync(`${process.cwd()}/${credentials[1].dataPath}`, 'utf8');
      const jsonData = JSON.parse(data);
      expect(jsonData.certification).toEqual(expect.any(Object));
    });

    describe('generate test suite result by template', () => {
      it('should show FAIL in the report when data invalidate', () => {
        expect(stdout).toMatch(/FAIL/);
        expect(stdout).toMatch(/Your credentials are not UNTP compliant/);
        expect(stdout).toContain('certification field must be array');
      });
    });
  });

  describe('process test runner and final report return WARN', () => {
    let credentialFileName: string;
    let storePath: string;
    let stdout: any;
    let credentials: ConfigContent[];

    const mockPath = `${process.cwd()}/integration/cli/mock/untpTestWarn`;
    beforeAll((done) => {
      credentialFileName = 'credentialsExample.json';
      storePath = `${mockPath}/${credentialFileName}`;
      const fileContent = fs.readFileSync(storePath, 'utf8');

      try {
        credentials = JSON.parse(fileContent).credentials;
      } catch (error) {
        expect(error).toBeNull();
      }

      exec(`yarn untp test -c ${storePath}`, (error, result) => {
        if (error) {
          console.error(`execSync error: ${error}`);
          return;
        }

        stdout = result;
        done();
      });
    });

    it('should exist the volume in quantityList of objectEvent data', () => {
      const data = fs.readFileSync(`${process.cwd()}/${credentials[0].dataPath}`, 'utf8');
      const jsonData = JSON.parse(data);
      expect(jsonData.quantityList[0].volume).toEqual(expect.any(String));
    });

    describe('generate test suite result by template', () => {
      it('should show WARN in the report when data invalidate', () => {
        expect(stdout).toMatch(/WARN/);
        expect(stdout).toMatch(/Your credentials are UNTP compliant, but have extended the data model/);
      });
    });
  });

  describe('process test runner with result combine FAIL and WARN and final report return FAIL', () => {
    let credentialFileName: string;
    let storePath: string;
    let stdout: any;
    let credentials: ConfigContent[];

    const mockPath = `${process.cwd()}/integration/cli/mock/untpTestFailuresAndWarnings`;
    beforeAll((done) => {
      credentialFileName = 'credentialsExample.json';
      storePath = `${mockPath}/${credentialFileName}`;
      const fileContent = fs.readFileSync(storePath, 'utf8');

      try {
        credentials = JSON.parse(fileContent).credentials;
      } catch (error) {
        expect(error).toBeNull();
      }

      exec(`yarn untp test -c ${storePath}`, (error, result) => {
        if (error) {
          console.error(`execSync error: ${error}`);
          return;
        }

        stdout = result;
        done();
      });
    });

    it('should exist the volume in quantityList of objectEvent data', () => {
      const data = fs.readFileSync(`${process.cwd()}/${credentials[1].dataPath}`, 'utf8');
      const jsonData = JSON.parse(data);
      expect(jsonData.quantityList[1].volume).toEqual(expect.any(String));
    });

    it('should not exist the quantity in transformationEvent data', () => {
      const data = fs.readFileSync(`${process.cwd()}/${credentials[2].dataPath}`, 'utf8');
      const jsonData = JSON.parse(data);
      expect(jsonData.outputQuantityList[0]).not.toHaveProperty('quantity');
    });

    describe('generate test suite result by template', () => {
      it('should show WARN in the report when data invalidate', () => {
        expect(stdout).toMatch(/FAIL/);
        expect(stdout).toMatch(/Your credentials are not UNTP compliant/);
        expect(stdout).toContain('field must have required property');
      });
    });
  });
});
