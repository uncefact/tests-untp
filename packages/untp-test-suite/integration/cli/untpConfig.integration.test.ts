import fs from 'fs';
import { exec } from 'child_process';

describe("CLI 'untp config' Commands", () => {
  it('should create a credential file successfully', () => {
    const credentialFileName = 'credentials.json';
    const storePath = `${process.cwd()}/${credentialFileName}`;
    exec('yarn untp config', async (error, stdout) => {
      if (error) {
        console.error(`execSync error: ${error}`);
        return;
      }

      expect(stdout).not.toBeNull();
      expect(fs.existsSync(storePath)).toBe(true);

      const fileContent = await fs.promises.readFile(`${process.cwd()}/${credentialFileName}`, 'utf-8');
      expect(fileContent).toContain('digitalConformityCredential');
      expect(fileContent).toContain('digitalTraceabilityEvent');
      expect(fileContent).toContain('digitalProductPassport');
      expect(fileContent).toContain('digitalFacilityRecord');
    });
  });
});
