export default {
  implementationName: 'Tier 1 Test Suite',
  testSuites: {
    QrLinkEncrypted: {
      url: 'http://localhost:3003/verify?q=%7B%22payload%22%3A%7B%22uri%22%3A%22http%3A%2F%2Flocalhost%3A3334%2Fv1%2Fverifiable-credentials%2F7a07aa7c-c961-4c74-a714-a6188cadd8f6.json%22%2C%22key%22%3A%222e2a9af227350b73733988ccb93581a5449cafa64394c13ffc7142b3b0b280b6%22%2C%22hash%22%3A%22a813f8aa1cdb5f391ec227d5a1f76a2764df7112bb26cd035b547a30ade03c8e%22%7D%7D',
      headers: {},
      method: 'GET',
    },
    QrLinkUnencrypted: {
      url: 'http://localhost:3003/verify/?q=%7B%22payload%22%3A%7B%22uri%22%3A%22http%3A%2F%2Flocalhost%3A3334%2Fv1%2Fverifiable-credentials%2F61bdef77-0bcf-47d8-a6e6-00074e530e31.json%22%2C%20%22hash%22%3A%229db052ff7b36aa3be34c4a92fb9444314b786380815984d7aba81af97123ce16%22%7D%7D',
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
