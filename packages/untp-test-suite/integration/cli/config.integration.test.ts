const { exec } = require('child_process');
const fs = require('fs');

describe("CLI 'untp' Options", () => {
  const execCommand = (command: string, expectedOutput: string) => {
    exec(command, (error, stdout) => {
      if (error) {
        console.error(`execSync error: ${error}`);
        return;
      }

      expect(stdout).not.toBeNull();
      expect(stdout).toContain(expectedOutput);
    });
  };

  describe('with yarn', () => {
    it('should display the untp help by default', () => {
      execCommand('yarn untp', 'Usage: untp [options] [command]');
    });

    it('should display the untp help with --help', () => {
      execCommand('yarn untp --help', 'Usage: untp [options] [command]');
    });

    it('should return the untp version', () => {
      execCommand('yarn untp --version', '0.0.1');
    });
  });

  describe('with npm', () => {
    it('should display the untp help by default', () => {
      execCommand('npm run untp', 'Usage: untp [options] [command]');
    });

    it('should display the untp help with --help', () => {
      execCommand('npm run untp -- --help', 'Usage: untp [options] [command]');
    });

    it('should return the untp version', () => {
      execCommand('npm run untp -- --version', '0.0.1');
    });
  });
});

describe("CLI 'untp config' Commands", () => {
  it('should create a credential file successfully', () => {
    const credentialFileName = 'credentials.json';
    const storePath = `${process.cwd()}/${credentialFileName}`;

    exec('yarn untp config', (error, stdout) => {
      if (error) {
        console.error(`execSync error: ${error}`);
        return;
      }

      expect(stdout).not.toBeNull();
      expect(fs.existsSync(storePath)).toBe(true);
    });
  });
});
