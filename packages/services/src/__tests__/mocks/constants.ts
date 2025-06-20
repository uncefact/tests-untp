export const contextTransformationEvent = {
  transformationEventCredential: {
    mappingFields: [
      {
        sourcePath: '/',
        destinationPath: '/',
      },
    ],
  },
  dppCredentials: [
    {
      mappingFields: [
        {
          sourcePath: '/',
          destinationPath: '/',
        },
      ],
    },
  ],
  epcisTransformationEvent: {
    context: ['https://dpp-json-ld.s3.ap-southeast-2.amazonaws.com/transformation-event-ld.json'],
    renderTemplate: [{ template: '<p>Render epcis template</p>', '@type': 'WebRenderingTemplate2022' }],
    type: ['TransformationEventCredential'],
    dlrIdentificationKeyType: 'gtin',
    dlrLinkTitle: 'EPCIS transformation event VC',
    dlrVerificationPage: 'https://web.agtrace.showthething.com/verify',
    dlrQualifierPath: '',
  },
  dpp: {
    context: ['https://dpp-json-ld.s3.ap-southeast-2.amazonaws.com/dppld.json'],
    renderTemplate: [{ template: '<p>Render dpp template</p>', '@type': 'WebRenderingTemplate2022' }],
    type: ['DigitalProductPassport'],
    dlrIdentificationKeyType: 'gtin',
    dlrLinkTitle: 'Digital Product Passport',
    dlrVerificationPage: 'https://web.agtrace.showthething.com/verify',
    dlrQualifierPath: '',
  },
  vckit: {
    vckitAPIUrl: 'http://localhost:3332',
    issuer: 'did:web:cd28-2402-800-6314-9b5f-6c75-aaf-7382-43e9.ngrok-free.app',
  },
  dlr: {
    dlrAPIUrl: 'http://localhost',
    dlrAPIKey: '5555555555555',
    namespace: 'gs1',
    linkRegisterPath: 'resolver',
  },
  storage: {
    url: 'https://storage.example.com',
    params: {
      bucket: 'transformation-event-bucket',
    },
  },
  productTransformation: {
    inputItems: [{ quantity: 1, uom: 'head', productClass: 'cattle' }],
    outputItems: [
      {
        productID: [
          {
            ai: '01',
            value: '9359502000041',
          },
          {
            ai: '10',
            value: 'ABC123',
          },
        ],
        productClass: 'Beef Silverside',
        quantity: 500,
        weight: 500,
        uom: 'kilogram',
        image:
          'https://gs1ausaactivateprod1.blob.core.windows.net/935950200000/09359502000041/AgTace-Meats-Silverside.png?sv=2019-07-07&sr=c&si=read&sig=1b9unDt%2FV7M0jCuNIbn47AaES0XK%2FOgL6QbRcuBGPOw%3D',
        description: 'Deforestation-free Beef Silverside',
      },
      {
        productID: [
          {
            ai: '01',
            value: '9359502000034',
          },
          {
            ai: '10',
            value: 'ABC123',
          },
        ],
        productClass: 'Beef Scotch Fillet',
        quantity: 300,
        weight: 300,
        uom: 'kilogram',
        image:
          'https://gs1ausaactivateprod1.blob.core.windows.net/935950200000/09359502000034/Beef-Scotch-Fillet-Steak-300g.png?sv=2019-07-07&sr=c&si=read&sig=1b9unDt%2FV7M0jCuNIbn47AaES0XK%2FOgL6QbRcuBGPOw%3D',
        description: 'Deforestation-free Beef Scotch Fillet',
      },
      {
        productID: [
          {
            ai: '01',
            value: '9359502000010',
          },
          {
            ai: '10',
            value: 'ABC123',
          },
        ],
        productClass: 'Beef Rump Steak',
        quantity: 250,
        weight: 250,
        uom: 'kilogram',
        image:
          'https://gs1ausaactivateprod1.blob.core.windows.net/935950200000/09359502000010/Beef-Rump-Steak-250g.png?sv=2019-07-07&sr=c&si=read&sig=1b9unDt%2FV7M0jCuNIbn47AaES0XK%2FOgL6QbRcuBGPOw%3D',
        description: 'Deforestation-free Beef Rump Steak',
      },
    ],
  },
  identifierKeyPath: '/NLIS',
};

export const dataTransformationEvent = {
  data: {
    NLIS: ['NH020188LEJ00012', 'NH020188LEJ00013'],
    product: {
      manufacturer: {
        name: "Pete's Meats",
      },
    },
  },
};
/*============================= */
export const contextDPP = {
  vckit: {
    vckitAPIUrl: 'https://vckit.example.com',
    issuer: 'did:web:example.com',
  },
  dpp: {
    context: ['https://www.w3.org/2018/credentials/v1'],
    renderTemplate: [{ template: '<p>Render dpp template</p>', '@type': 'WebRenderingTemplate2022' }],
    type: ['DigitalProductPassport'],
    dlrLinkTitle: 'Livestock Passport',
    dlrVerificationPage: 'https://web.example.com/verify',
  },
  dlr: {
    dlrAPIUrl: 'http://dlr.example.com',
    dlrAPIKey: '1234',
    namespace: 'gs1',
    linkRegisterPath: 'resolver',
  },
  storage: {
    url: 'https://storage.example.com',
    params: {
      bucket: 'dpp-bucket',
    },
  },
  identifierKeyPath: '/herd/identifier',
};

export const dataDPP = {
  data: {
    herd: {
      identifier: '9359502000010',
    },
  },
  qualifierPath: '/10/ABC123',
};

/*============================= */

export const transactionEventMock = {
  nlisidMock: '9988776600000',
  uploadedTransactionEventLinkMock: `https://s3.ap-southeast-2.amazonaws.com/9988776600000-mock.json`,
  transactionEventDLRMock: `https://example-dlr.com/nlisid/9988776600000?linkType=all`,
  transactionVCMock: {
    '@context': ['https://example.sh/TransactionEvent.jsonld'],
    type: ['DigitalTraceabilityEvent'],
    issuer: 'did:web:example.com',
    credentialSubject: {
      sourceParty: { partyID: `https://beef-steak-shop.com/info.json`, name: 'Beef Steak Shop' },
      destinationParty: { partyID: 'https://beef-shop.com/info.json', name: 'Beef Shop' },
      transaction: {
        type: 'inv',
        identifier: 'uuid-123456',
        documentURL: 'https://transaction-example.com/trans-uuid-1.json',
      },
      itemList: [{ itemID: 'https://beef-example.com/info-uuid-1.json', name: 'Beef' }],
      quantityList: [{ productClass: 'Beef', quantity: '50', uom: 'units' }],
    },
  },
};

/*============================= */

export const aggregationEventMock = {
  parentItem: [{ ai: '01', value: '09359502000010' }],
  uploadedAggregationEventLinkMock: `https://s3.ap-southeast-2.amazonaws.com/9988776600000.json`,
  aggregationEventDLRMock: `https://example.com/gtin/9988776600000.json`,
  aggregationVCMock: {
    '@context': ['https://example.sh/AggregationEvent.jsonld'],
    type: ['AggregationEventCredential'],
    issuer: 'did:web:example.com',
    credentialSubject: {
      parentItem: {
        itemID: `https://example.com/gtin/beef-container-gin-9988776600000.json`,
        name: 'Beef Variety Container',
      },
      childItems: [{ itemID: 'http://example.com/beef-scotch-box.json', name: 'Beef Scotch Fillet Box' }],
      childQuantityList: [{ productClass: 'Beef', quantity: '50', uom: 'box' }],
    },
  },
};

export const traceabilityEventContext = {
  vckit: {
    vckitAPIUrl: 'https://api.vckit.example.com',
    issuer: 'did:example:123456789abcdefghi',
  },
  traceabilityEvent: {
    context: ['https://www.w3.org/2018/credentials/v1', 'https://gs1.org/voc/'],
    type: ['ObjectEventCredential'],
    renderTemplate: [
      {
        template: '<div><h2>Object Event</h2></div>',
        '@type': 'WebRenderingTemplate2022',
      },
    ],
    dlrLinkTitle: 'Object Event',
    dlrVerificationPage: 'https://verify.example.com',
  },
  storage: {
    url: 'https://storage.example.com/upload',
    params: {
      bucket: 'traceability-event-bucket',
    },
  },
  dlr: {
    dlrAPIUrl: 'https://dlr.example.com/api',
    dlrAPIKey: 'dlr-api-key-12345',
    namespace: 'gs1',
    linkRegisterPath: 'resolver',
  },
  identifierKeyPath: '/0/id',
};

export const digitalIdentityAnchorContext = {
  vckit: {
    vckitAPIUrl: 'https://vckit.example.com',
    issuer: 'did:web:example.com',
  },
  digitalIdentityAnchor: {
    context: ['https://www.w3.org/2018/credentials/v1'],
    renderTemplate: [{ template: '<p>Render dpp template</p>', '@type': 'WebRenderingTemplate2022' }],
    type: ['DigitalIdentityAnchor'],
    dlrLinkTitle: 'DigitalIdentityAnchor',
    dlrVerificationPage: 'https://web.example.com/verify',
  },
  dlr: {
    dlrAPIUrl: 'http://dlr.example.com',
    dlrAPIKey: '1234',
    namespace: 'gs1',
    linkRegisterPath: 'resolver',
  },
  storage: {
    url: 'https://storage.example.com',
    params: {},
  },
  identifierKeyPath: '/id',
};

export const digitalFacilityRecordContext = {
  vckit: {
    vckitAPIUrl: 'https://vckit.example.com',
    issuer: 'did:web:example.com',
  },
  digitalFacilityRecord: {
    context: ['https://www.w3.org/2018/credentials/v1'],
    renderTemplate: [{ template: '<p>Render dpp template</p>', '@type': 'WebRenderingTemplate2022' }],
    type: ['DigitalFacilityRecord'],
    dlrLinkTitle: 'DigitalFacilityRecord',
    dlrVerificationPage: 'https://web.example.com/verify',
  },
  dlr: {
    dlrAPIUrl: 'http://dlr.example.com',
    dlrAPIKey: '1234',
    namespace: 'gs1',
    linkRegisterPath: 'resolver',
  },
  storage: {
    url: 'https://storage.example.com',
    params: {},
  },
  identifierKeyPath: '/id',
};

export const digitalConformityCredentialContext = {
  vckit: {
    vckitAPIUrl: 'https://vckit.example.com',
    issuer: 'did:web:example.com',
  },
  digitalConformityCredential: {
    context: ['https://www.w3.org/2018/credentials/v1'],
    renderTemplate: [{ template: '<p>Render dcc template</p>', '@type': 'WebRenderingTemplate2022' }],
    type: ['DigitalConformityCredential'],
    dlrLinkTitle: 'DigitalConformityCredential',
    dlrVerificationPage: 'https://web.example.com/verify',
  },
  dlr: {
    dlrAPIUrl: 'http://dlr.example.com',
    dlrAPIKey: '1234',
    namespace: 'gs1',
    linkRegisterPath: 'resolver',
  },
  storage: {
    url: 'https://storage.example.com',
    params: {},
  },
  identifierKeyPath: '/id',
};
