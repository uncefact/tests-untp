export default {
  implementationName: 'VCkit',
  testSuites: {
    QrLinkEncrypted: {
      url: 'https://example.com/verify',
      headers: {},
      method: 'GET',
    },
    RenderTemplate2024: {
      url: 'http://localhost:3332/agent/renderCredential',
      headers: {},
      method: 'POST',
    },
  },
};