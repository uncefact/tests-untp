import { jest } from '@jest/globals';
import fs from 'fs';
import { exec } from 'child_process';
import { IConfigContent } from '../../build/core/types';

describe("CLI 'untp test' Commands with local schema", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Validation of `schema` in the configuration file', () => {
    let credentialFileName: string;
    let storePath: string;
    let stdout: any;
    let credentials: IConfigContent[];

    const mockPath = `${process.cwd()}/integration/mock/untpTestPass`;
    beforeAll((done) => {
      credentialFileName = 'credentialsExample.json';
      storePath = `${mockPath}/${credentialFileName}`;
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

    it('should ensure that the schema file of each credential exists', () => {
      expect(stdout).not.toBeNull();
      for (const credential of credentials) {
        expect(fs.existsSync(`${process.cwd()}/src/schemas/${credential.type}/${credential.version}/schema.json`)).toBe(
          true,
        );
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

  describe('process test runner and final report return PASS', () => {
    let credentialFileName: string;
    let storePath: string;
    let stdout: any;

    const mockPath = `${process.cwd()}/integration/mock/untpTestPass`;
    beforeAll((done) => {
      credentialFileName = 'credentialsExample.json';
      storePath = `${mockPath}/${credentialFileName}`;

      exec(`yarn untp test -c ${storePath}`, (error, result) => {
        if (error) {
          console.error(`execSync error: ${error}`);
          return;
        }

        stdout = result;
        done();
      });
    });

    it('should show PASS in report when all data validate', () => {
      expect(stdout).toMatch(/PASS/);
      expect(stdout).toContain('Your credentials are UNTP compliant');
    });
  });

  describe('process test runner and final report return FAIL', () => {
    let credentialFileName: string;
    let storePath: string;
    let stdout: any;

    const mockPath = `${process.cwd()}/integration/mock/untpTestFail`;
    beforeAll((done) => {
      credentialFileName = 'credentialsExample.json';
      storePath = `${mockPath}/${credentialFileName}`;

      exec(`yarn untp test -c ${storePath}`, (error, result) => {
        if (error) {
          console.error(`execSync error: ${error}`);
          return;
        }

        stdout = result;
        done();
      });
    });

    it('should show FAIL in the report when data invalidate', () => {
      expect(stdout).toMatch(/FAIL/);
      expect(stdout).toMatch(/Your credentials are not UNTP compliant/);
      expect(stdout).toContain('certification field must be array');
      expect(stdout).toContain('type field should have required property');
      expect(stdout).toContain('version field should have required property');
      expect(stdout).toContain('dataPath field should have required property');
    });
  });

  describe('process test runner and final report return WARN', () => {
    let credentialFileName: string;
    let storePath: string;
    let stdout: any;

    const mockPath = `${process.cwd()}/integration/mock/untpTestWarn`;
    beforeAll((done) => {
      credentialFileName = 'credentialsExample.json';
      storePath = `${mockPath}/${credentialFileName}`;

      exec(`yarn untp test -c ${storePath}`, (error, result) => {
        if (error) {
          console.error(`execSync error: ${error}`);
          return;
        }

        stdout = result;
        done();
      });
    });

    it('should show WARN in the report when data invalidate', () => {
      expect(stdout).toMatch(/WARN/);
      expect(stdout).toMatch(/Your credentials are UNTP compliant, but have extended the data model/);
    });
  });

  describe('process test runner with result combine FAIL and WARN and final report return FAIL', () => {
    let credentialFileName: string;
    let storePath: string;
    let stdout: any;

    const mockPath = `${process.cwd()}/integration/mock/untpTestFailuresAndWarnings`;
    beforeAll((done) => {
      credentialFileName = 'credentialsExample.json';
      storePath = `${mockPath}/${credentialFileName}`;

      exec(`yarn untp test -c ${storePath}`, (error, result) => {
        if (error) {
          console.error(`execSync error: ${error}`);
          return;
        }

        stdout = result;
        done();
      });
    });

    it('should show WARN in the report when data invalidate', () => {
      expect(stdout).toMatch(/FAIL/);
      expect(stdout).toMatch(/Your credentials are not UNTP compliant/);
      expect(stdout).toContain('field must have required property');
    });
  });
});

describe("CLI 'untp test' Commands with remote schema", () => {
  describe('validation of `schema` in the configuration file', () => {
    let credentialFileName: string;
    let storePath: string;
    let stdout: any;
    let credentials: IConfigContent[];

    const mockPath = `${process.cwd()}/integration/mock/untpTestPass`;

    beforeAll((done) => {
      credentialFileName = 'credentialsRemoteSchema.json';
      storePath = `${mockPath}/${credentialFileName}`;
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

    it('should ensure that the schema file of each credential exists', () => {
      expect(stdout).not.toBeNull();
      for (const credential of credentials) {
        expect(fs.existsSync(`${process.cwd()}/src/schemas/${credential.type}/${credential.version}/schema.json`)).toBe(
          true,
        );
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

  describe('process test runner and final report return PASS', () => {
    let credentialFileName: string;
    let storePath: string;
    let stdout: any;

    const mockPath = `${process.cwd()}/integration/mock/untpTestPass`;
    beforeAll((done) => {
      credentialFileName = 'credentialsRemoteSchema.json';
      storePath = `${mockPath}/${credentialFileName}`;

      exec(`yarn untp test -c ${storePath}`, (error, result) => {
        if (error) {
          console.error(`execSync error: ${error}`);
          return;
        }

        stdout = result;
        done();
      });
    });

    it('should show PASS in report when all data validate', () => {
      expect(stdout).toMatch(/PASS/);
      expect(stdout).toContain('Your credentials are UNTP compliant');
    });
  });

  describe('process test runner and final report return FAIL', () => {
    let credentialFileName: string;
    let storePath: string;
    let stdout: any;

    const mockPath = `${process.cwd()}/integration/mock/untpTestFail`;
    beforeAll((done) => {
      credentialFileName = 'credentialsRemoteSchema.json';
      storePath = `${mockPath}/${credentialFileName}`;

      exec(`yarn untp test -c ${storePath}`, (error, result) => {
        if (error) {
          console.error(`execSync error: ${error}`);
          return;
        }

        stdout = result;
        done();
      });
    });

    it('should show FAIL in the report when data invalidate', () => {
      expect(stdout).toMatch(/FAIL/);
      expect(stdout).toMatch(/Your credentials are not UNTP compliant/);
      expect(stdout).toContain('url field Failed to fetch data ');
      expect(stdout).toContain(`field must have required property 'id'.`);
      expect(stdout).toContain(`url field The URL 'in-valid-url' is not a valid URL..`);
      expect(stdout).toContain(`url field The URL 'abc://example.com' must use http or https protocol..`);
    });
  });

  describe('process test runner and final report return WARN', () => {
    let credentialFileName: string;
    let storePath: string;
    let stdout: any;

    const mockPath = `${process.cwd()}/integration/mock/untpTestWarn`;
    beforeAll((done) => {
      credentialFileName = 'credentialsRemoteSchema.json';
      storePath = `${mockPath}/${credentialFileName}`;

      exec(`yarn untp test -c ${storePath}`, (error, result) => {
        if (error) {
          console.error(`execSync error: ${error}`);
          return;
        }

        stdout = result;
        done();
      });
    });

    it('should show WARN in the report when data invalidate', () => {
      expect(stdout).toMatch(/WARN/);
      expect(stdout).toMatch(/Your credentials are UNTP compliant, but have extended the data model/);
    });
  });

  describe('process test runner with result combine FAIL and WARN and final report return FAIL', () => {
    let credentialFileName: string;
    let storePath: string;
    let stdout: any;

    const mockPath = `${process.cwd()}/integration/mock/untpTestFailuresAndWarnings`;
    beforeAll((done) => {
      credentialFileName = 'credentialsRemoteSchema.json';
      storePath = `${mockPath}/${credentialFileName}`;

      exec(`yarn untp test -c ${storePath}`, (error, result) => {
        if (error) {
          console.error(`execSync error: ${error}`);
          return;
        }

        stdout = result;
        done();
      });
    });

    it('should show WARN in the report when data invalidate', () => {
      expect(stdout).toMatch(/FAIL/);
      expect(stdout).toMatch(/Your credentials are not UNTP compliant/);
      expect(stdout).toContain('Additional property found');
      expect(stdout).toContain('url field Failed to fetch data from the URL');
    });
  });
});
