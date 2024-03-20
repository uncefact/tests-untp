const { exec } = require('child_process');

describe('yarn untp Options', () => {
  it('should returns the untp help', () => {
    exec('yarn untp', (error, stdout) => {
      if (error) {
        console.error(`execSync error: ${error}`);
        return;
      }

      expect(stdout).not.toBeNull();
      expect(stdout).toContain('Usage: untp [options] [command]');
    });
  });

  it('should returns the untp help', () => {
    exec('yarn untp --help', (error, stdout) => {
      if (error) {
        console.error(`execSync error: ${error}`);
        return;
      }

      expect(stdout).not.toBeNull();
      expect(stdout).toContain('Usage: untp [options] [command]');
    });
  });

  it('should returns the untp version', () => {
    exec('yarn untp test --version', (error, stdout) => {
      if (error) {
        console.error(`execSync error: ${error}`);
        return;
      }

      expect(stdout).not.toBeNull();
      expect(stdout).toContain('0.0.1');
    });
  });
});

describe('yarn untp test Commands', () => {
  it('should show error when call the untp config without input file', () => {
    const credentialFileName = 'credentials.json';
    const storePath = `${process.cwd()}/${credentialFileName}`;

    exec('yarn untp config', (error, stdout) => {
      if (error) {
        console.error(`execSync error: ${error}`);
        return;
      }

      expect(stdout).not.toBeNull();
      if (!storePath) {
        expect(stdout).toContain(`Credential file 'credentials.json' generated successfully!`);
      }

      expect(stdout).toContain(`Credential file 'credentials.json' already exists!`);
    });
  });
});
