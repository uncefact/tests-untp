export default {
  implementationName: 'VCkit',
  testSuites: {
    QrLinkEncrypted: {
      url: 'https://example.com/credential-verifier?q=%7B%22payload%22%3A%7B%22uri%22%3A%22https%3A%2F%2Fapi.vckit.showthething.com%2Fencrypted-storage%2Fencrypted-data%2F0a6031a9-2740-49cd-b12b-1ed02820f01d%22%2C%22key%22%3A%22d0ad322ec820a0a420262a6b7dbdafb16eb1d35af459182022bc531d18643546%22%2C%20%22hash%22%3A%20%22QmX8fk9hygXQDbt4KsGEMiUXbt7HDRnb772HNcKtZcL2Zr%22%7D%7D',
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