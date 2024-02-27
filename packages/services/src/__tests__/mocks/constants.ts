/*============================= */
export const contextObjectEvent = {
  vckit: {
    vckitAPIUrl: 'https://vckit.example.com',
    issuer: 'did:web:example.com',
  },
  dpp: {
    context: ['https://www.w3.org/2018/credentials/v1'],
    renderTemplate: [{ template: '<p>Render dpp template</p>', '@type': 'WebRenderingTemplate2022' }],
    type: ['DigitalProductPassport'],
    dlrLinkTitle: 'Livestock Passport',
    dlrIdentificationKeyType: 'nlis',
    dlrVerificationPage: 'https://web.example.com/verify',
  },
  dlr: {
    dlrAPIUrl: 'http://dlr.example.com',
    dlrAPIKey: '1234',
  },
  storage: {
    storageAPIUrl: 'https://storage.example.com',
    bucket: 'test-verifiable-credentials',
  },
  identifierKeyPaths: ['herd', 'NLIS'],
};

export const dataObjectEvent = {
  data: {
    herd: {
      NLIS: 'NH020188LEJ00012',
    },
  },
};

/*============================= */
