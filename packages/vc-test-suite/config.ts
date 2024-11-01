export default {
  implementationName: 'VCkit',
  testSuites: {
    QrLinkEncrypted: {
      url: 'http://localhost:3001/verify?q=%7B%22payload%22%3A%7B%22uri%22%3A%22http%3A%2F%2Flocalhost%3A3334%2Fv1%2Fverifiable-credentials%2Fc2eb5fee-da3b-411b-9b03-e8f7fb20dc3d.json%22%2C%22key%22%3A%22e5e0d20e35e2786773720cbba011ca26cca0d6fd279a6c3fd00980a5ed1fb5c8%22%2C%22hash%22%3A%2231e96f8b6896b9fc6f9b86267574b2926b5637e1f65027b437119cfd2033f3d7%22%7D%7D',
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
