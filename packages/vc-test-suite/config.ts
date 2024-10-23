export default {
  implementationName: 'VCkit',
  testSuites: {
    QrLinkEncrypted: {
      url: 'http://localhost:3003/verify/?q=%7B%22payload%22%3A%7B%22uri%22%3A%22http%3A%2F%2Flocalhost%3A3334%2Fv1%2Fverifiable-credentials%2F071fa063-660a-40e0-b2e0-3ee1b3e7ecff.json%22%2C%22hash%22%3A%2231e96f8b6896b9fc6f9b86267574b2926b5637e1f65027b437119cfd2033f3d7%22%2C%22key%22%3A%228703c4178dd098ba1384d3ba4071afb5b7efe3caae41b6672a060b4549412177%22%7D%7D',
      headers: {},
      method: 'GET',
    },
    RenderTemplate2024: {
      url: 'http://localhost:3332/agent/renderCredential',
      headers: { Authorization: 'Bearer test123' },
      method: 'POST',
    },
    Storage: {
      url: 'http://localhost:3334/v1/documents',
      encryptionUrl: 'http://localhost:3334/v1/credentials',
      headers: {},
      additionalParams: {},
      additionalPayload: { bucket: 'verifiable-credentials' },
    },
  },
};
