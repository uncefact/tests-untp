export const contextTransformationEvent = {
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
  },
  storage: {
    storageAPIUrl: 'https://storage.agtrace.showthething.com',
    bucket: 'agtrace-test-verifiable-credentials',
  },
  productTransformation: {
    inputItems: [{ quantity: 1, uom: 'head', productClass: 'cattle' }],
    outputItems: [
      {
        productID: '9359502000041',
        productClass: 'Beef Silverside',
        quantity: 500,
        weight: 500,
        uom: 'kilogram',
        image:
          'https://gs1ausaactivateprod1.blob.core.windows.net/935950200000/09359502000041/AgTace-Meats-Silverside.png?sv=2019-07-07&sr=c&si=read&sig=1b9unDt%2FV7M0jCuNIbn47AaES0XK%2FOgL6QbRcuBGPOw%3D',
        description: 'Deforestation-free Beef Silverside',
      },
      {
        productID: '9359502000034',
        productClass: 'Beef Scotch Fillet',
        quantity: 300,
        weight: 300,
        uom: 'kilogram',
        image:
          'https://gs1ausaactivateprod1.blob.core.windows.net/935950200000/09359502000034/Beef-Scotch-Fillet-Steak-300g.png?sv=2019-07-07&sr=c&si=read&sig=1b9unDt%2FV7M0jCuNIbn47AaES0XK%2FOgL6QbRcuBGPOw%3D',
        description: 'Deforestation-free Beef Scotch Fillet',
      },
      {
        productID: '9359502000010',
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
  identifierKeyPaths: ['NLIS'],
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
