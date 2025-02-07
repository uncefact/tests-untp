import * as untp from 'untp-test-suite';

describe('Issue DCC end-to-end testing flow', () => {
  it('Runs testing UNTP V0.5.0', async () => {
    const result = await untp.testCredentialHandler(
      {
        type: 'digitalConformityCredential',
        version: 'v0.5.0',
      },
      {},
    );
  });
});
