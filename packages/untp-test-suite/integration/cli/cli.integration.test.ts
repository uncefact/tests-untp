import { exec } from 'child_process';

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
