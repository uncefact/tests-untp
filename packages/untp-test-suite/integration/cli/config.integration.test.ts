const { exec } = require('child_process');
const fs = require('fs');

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
  it('should create credential file successful', () => {
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

describe('npm untp test Commands', () => {
  it('should returns the untp help', () => {
    exec('npm run untp', (error, stdout) => {
      if (error) {
        console.error(`execSync error: ${error}`);
        return;
      }

      expect(stdout).not.toBeNull();
      expect(stdout).toContain('Usage: untp [options] [command]');
    });
  });

  it('should returns the untp help', () => {
    exec('npm run untp -- -h', (error, stdout) => {
      if (error) {
        console.error(`execSync error: ${error}`);
        return;
      }

      expect(stdout).not.toBeNull();
      expect(stdout).toContain('Usage: untp [options] [command]');
    });
  });

  it('should returns the untp version', () => {
    exec('npm run untp -- -v', (error, stdout) => {
      if (error) {
        console.error(`execSync error: ${error}`);
        return;
      }

      expect(stdout).not.toBeNull();
      expect(stdout).toContain('0.0.1');
    });
  });
});

describe('npm untp test Commands', () => {
  it('should create credential file successful', () => {
    const credentialFileName = 'credentials.json';
    const storePath = `${process.cwd()}/${credentialFileName}`;

    exec('npm run untp config', (error, stdout) => {
      if (error) {
        console.error(`execSync error: ${error}`);
        return;
      }

      expect(stdout).not.toBeNull();
      expect(fs.existsSync(storePath)).toBe(true);
    });
  });
});
