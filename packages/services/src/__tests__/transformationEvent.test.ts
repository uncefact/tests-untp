import {
  issueDPP,
  issueEpcisTransformationEvent,
  processTransformationEvent,
  uploadVC,
} from '../../build/epcisEvents/transformationEvent';
import { issueVC, contextDefault } from '../../build/vckit.service';
import { epcisTransformationCrendentialSubject } from '../../build/epcis.service';
import { uploadJson } from '../../build/storage.service';
import { registerLinkResolver, IdentificationKeyType } from '../../build/linkResolver.service';
import { fillArray } from '../../build/utils/helpers';
import { IInputItems } from '../epcisEvents/types';

jest.mock('../../build/vckit.service', () => ({
  issueVC: jest.fn(),
  contextDefault: ['https://www.w3.org/2018/credentials/v1', 'https://w3id.org/vc-revocation-list-2020/v1'],
}));

jest.mock('../../build/epcis.service', () => ({
  epcisTransformationCrendentialSubject: jest.fn(),
}));

jest.mock('../../build/storage.service', () => ({
  uploadJson: jest.fn(),
}));

jest.mock('../../build/linkResolver.service', () => ({
  registerLinkResolver: jest.fn(),
  IdentificationKeyType: {
    gtin: 'gtin',
    nlisid: 'nlisid',
  },
}));

describe('Transformation event', () => {
  it('should issue epcis transformation event with multiple nilsid transforms the event', async () => {
    let expectResult = {};
    (issueVC as jest.Mock).mockImplementation((value) => {
      expectResult = {
        '@context': [...contextDefault, ...value.context],
        type: ['VerifiableCredential', ...value.type],
        issuer: {
          id: value.issuer,
        },
        credentialSubject: value.credentialSubject,
        render: value.render,
      };

      return Promise.resolve(expectResult);
    });

    const data = {
      nlisids: [
        {
          value: 'NH020188LEJ00012',
        },
        {
          value: 'NH020188LEJ00013',
        },
      ],
    };

    const context = {
      epcisVckit: {
        context: ['https://www.w3.org/2018/credentials/v1'],
        renderTemplate: [{ template: '<p>Render template</p>', '@type': 'WebRenderingTemplate2022' }],
        issuer: 'did:web:84d1-115-73-178-202.ngrok-free.app',
        type: ['TransformationEventCredential'],
        vckitAPIUrl: 'http://localhost:3332',
      },
      gtins: ['9359502000034', '9359502000010'],
      dlr: {
        dlrAPIUrl: 'http://localhost',
        dlrAPIKey: '1234',
        identificationKeyType: '',
        linkTitle: '',
        verificationPage: '',
      },
      productTranformation: {
        inputItems: [{ quantity: 1, uom: 'head', productClass: 'Cattle' }],
        outputItems: {
          '9359502000034': {
            productClass: 'Beef Scotch Fillet',
            quantity: 300,
            weight: 300,
            uom: 'kilogram',
            image:
              'https://gs1ausaactivateprod1.blob.core.windows.net/935950200000/09359502000034/Beef-Scotch-Fillet-Steak-300g.png?sv=2019-07-07&sr=c&si=read&sig=1b9unDt%2FV7M0jCuNIbn47AaES0XK%2FOgL6QbRcuBGPOw%3D',
            description: 'Deforestation-free Beef Scotch Fillet',
          },
          '9359502000010': {
            productClass: 'Beef Rump Steak',
            quantity: 250,
            weight: 250,
            uom: 'kilogram',
            image:
              'https://gs1ausaactivateprod1.blob.core.windows.net/935950200000/09359502000010/Beef-Rump-Steak-250g.png?sv=2019-07-07&sr=c&si=read&sig=1b9unDt%2FV7M0jCuNIbn47AaES0XK%2FOgL6QbRcuBGPOw%3D',
            description: 'Deforestation-free Beef Rump Steak',
          },
        },
      },
    };

    (epcisTransformationCrendentialSubject as jest.Mock).mockImplementation((nlisids) => {      
      const detailOfProducts: any = context.productTranformation.outputItems;
      const outputItemList = context.gtins.map((gtin) => {
        return {
          itemID: gtin,
          link: `${context.dlr.dlrAPIUrl}/gtin/${gtin}?linkType=gs1:certificationInfo`,
          name: detailOfProducts[gtin]?.productClass,
        };
      });

      const inputItems = nlisids?.map((item: string) => {
        return {
          itemID: item,
          link: `${context.dlr.dlrAPIUrl}/nlisid/${item}?linkType=gs1:certificationInfo`,
          name: 'Cattle',
        };
      });

      const countInputItems = fillArray(nlisids, context.productTranformation.inputItems);

      return {
        eventID: '1234',
        eventType: 'Transformation',
        eventTime: 'Mon, 20 Feb 2023 8:26:54 GMT',
        actionCode: 'observe',
        dispositionCode: 'active',
        businessStepCode: 'packing',
        readPointId: '48585',
        locationId: 'https://plus.codes/4RRG6MJF+C6X',
        inputItemList: inputItems,
        inputQuantityList: countInputItems.map((item: IInputItems) => ({
          productClass: item.productClass,
          quantity: item.quantity,
          uom: item.uom,
        })),
        outputItemList,
      };
    });

    const vc = await issueEpcisTransformationEvent(
      context.epcisVckit,
      context.gtins,
      context.dlr,
      data,
      context.productTranformation,
    );
    expect(vc).toEqual(expectResult);
  });

  it('should upload vc and return link to the uploaded json file', async () => {
    let expectResult = '';
    (uploadJson as jest.Mock).mockImplementation(({ filename, bucket }: { filename: string; bucket: string }) => {
      expectResult = `https://${bucket}.s3.ap-southeast-2.amazonaws.com/${filename}`;
      return expectResult;
    });
    const mockVc = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiableCredential', 'MockEvent'],
      issuer: {
        id: 'did:example:123',
      },
      credentialSubject: { id: 'did:example:123', name: 'John Doe' },
      issuanceDate: '2021-06-22T00:00:00Z',
      render: {},
      proof: {
        type: 'JwsSignature2020',
        created: '2021-06-22T00:00:00Z',
        verificationMethod: 'did:example:123#key',
      },
    };

    const filename = 'epcis-transformation-event/1234';
    const urlUpload = await uploadVC(filename, mockVc, { storageAPIUrl: 'http://localhost', bucket: 'bucket' });
    expect(urlUpload).toEqual(expectResult);
  });

  it('should call issueDPP and return valid vc', async () => {
    let expectResult = {};
    (issueVC as jest.Mock).mockImplementation((value) => {
      expectResult = {
        '@context': [...contextDefault, ...value.context],
        type: ['VerifiableCredential', ...value.type],
        issuer: {
          id: value.issuer,
        },
        credentialSubject: value.credentialSubject,
        render: value.render,
      };

      return Promise.resolve(expectResult);
    });

    const data = {
      nlisids: [
        {
          value: 'NH020188LEJ00012',
        },
        {
          value: 'NH020188LEJ00013',
        },
      ],
    };

    const context = {
      epcisVckit: {
        context: ['https://epcis-mock.com/epcis.json'],
        renderTemplate: [{ template: '<p>Render epcis template</p>', '@type': 'WebRenderingTemplate2022' }],
        issuer: 'did:web:84d1-115-73-178-202.ngrok-free.app',
        type: ['TransformationEventCredential'],
        vckitAPIUrl: 'http://localhost:3332',
      },
      dppVckit: {
        context: ['https://dpp-mock.com/dppld.json'],
        renderTemplate: [{ template: '<p>Render dpp template</p>', '@type': 'WebRenderingTemplate2022' }],
        issuer: 'did:web:84d1-115-73-178-202.ngrok-free.app',
        type: ['DigitalProductPassport'],
        vckitAPIUrl: 'http://localhost:3332',
      },
      gtins: ['9359502000034'],
      dlr: {
        dlrAPIUrl: 'http://localhost',
        dlrAPIKey: '1234',
        identificationKeyType: 'gtin',
        linkTitle: 'Digital Product Passport',
        verificationPage: 'http://localhost/verify',
      },
      storage: {
        storageAPIUrl: 'https://storage.mock.com',
        bucket: 'test-verifiable-credentials',
      },
      productTranformation: {
        inputItems: [{ quantity: 1, uom: 'head', productClass: 'Cattle' }],
        outputItems: {
          '9359502000034': {
            productClass: 'Beef Scotch Fillet',
            quantity: 300,
            weight: 300,
            uom: 'kilogram',
            image:
              'https://gs1ausaactivateprod1.blob.core.windows.net/935950200000/09359502000034/Beef-Scotch-Fillet-Steak-300g.png?sv=2019-07-07&sr=c&si=read&sig=1b9unDt%2FV7M0jCuNIbn47AaES0XK%2FOgL6QbRcuBGPOw%3D',
            description: 'Deforestation-free Beef Scotch Fillet',
          },
          '9359502000010': {
            productClass: 'Beef Rump Steak',
            quantity: 250,
            weight: 250,
            uom: 'kilogram',
            image:
              'https://gs1ausaactivateprod1.blob.core.windows.net/935950200000/09359502000010/Beef-Rump-Steak-250g.png?sv=2019-07-07&sr=c&si=read&sig=1b9unDt%2FV7M0jCuNIbn47AaES0XK%2FOgL6QbRcuBGPOw%3D',
            description: 'Deforestation-free Beef Rump Steak',
          },
        },
      },
    };

    const vc = await issueDPP(
      context.dppVckit,
      context.gtins[0],
      data.nlisids.length,
      'http://localhost/gtin/9359502000034?linkType=all',
      context.productTranformation,
      data,
    );

    expect(vc).toEqual(expectResult);
  });

  it('should throw error when issue DPP with gtin is invalid', async () => {
    try {
      const mockVc = {
        context: [],
        renderTemplate: [],
        issuer: '',
        type: [''],
        vckitAPIUrl: '',
      };

      await issueDPP(mockVc, '', 0, '', { inputItems: [], outputItems: {} }, {});
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
    }
  });

  it('should call registerLinkResolver transformation event', async () => {
    (uploadJson as jest.Mock).mockImplementation(() => {
      return `https://bucket.s3.ap-southeast-2.amazonaws.com/epcis-transformation-event/1234`;
    });
    (registerLinkResolver as jest.Mock).mockImplementation(
      (
        url,
        identificationKeyType: IdentificationKeyType,
        identificationKey: string,
        linkTitle,
        verificationPage,
        dlrAPIUrl: string,
        dlrAPIKey,
        qualifierPath,
      ) => {
        return `${dlrAPIUrl}/${identificationKeyType}/${identificationKey}?linkType=all`;
      },
    );
    const data = {
      nlisids: [
        {
          value: 'NH020188LEJ00012',
        },
        {
          value: 'NH020188LEJ00013',
        },
      ],
    };

    const context = {
      epcisVckit: {
        context: ['https://epcis-mock.com/epcis.json'],
        renderTemplate: [{ template: '<p>Render epcis template</p>', '@type': 'WebRenderingTemplate2022' }],
        issuer: 'did:web:84d1-115-73-178-202.ngrok-free.app',
        type: ['TransformationEventCredential'],
        vckitAPIUrl: 'http://localhost:3332',
      },
      dppVckit: {
        context: ['https://dpp-mock.com/dppld.json'],
        renderTemplate: [{ template: '<p>Render dpp template</p>', '@type': 'WebRenderingTemplate2022' }],
        issuer: 'did:web:84d1-115-73-178-202.ngrok-free.app',
        type: ['DigitalProductPassport'],
        vckitAPIUrl: 'http://localhost:3332',
      },
      gtins: ['9359502000034', '9359502000010'],
      dlr: {
        dlrAPIUrl: 'http://localhost',
        dlrAPIKey: '1234',
        identificationKeyType: 'gtin',
        linkTitle: 'Digital Product Passport',
        verificationPage: 'http://localhost/verify',
      },
      storage: {
        storageAPIUrl: 'https://storage.mock.com',
        bucket: 'test-verifiable-credentials',
      },
      productTranformation: {
        inputItems: [{ quantity: 1, uom: 'head', productClass: 'Cattle' }],
        outputItems: {
          '9359502000034': {
            productClass: 'Beef Scotch Fillet',
            quantity: 300,
            weight: 300,
            uom: 'kilogram',
            image:
              'https://gs1ausaactivateprod1.blob.core.windows.net/935950200000/09359502000034/Beef-Scotch-Fillet-Steak-300g.png?sv=2019-07-07&sr=c&si=read&sig=1b9unDt%2FV7M0jCuNIbn47AaES0XK%2FOgL6QbRcuBGPOw%3D',
            description: 'Deforestation-free Beef Scotch Fillet',
          },
          '9359502000010': {
            productClass: 'Beef Rump Steak',
            quantity: 250,
            weight: 250,
            uom: 'kilogram',
            image:
              'https://gs1ausaactivateprod1.blob.core.windows.net/935950200000/09359502000010/Beef-Rump-Steak-250g.png?sv=2019-07-07&sr=c&si=read&sig=1b9unDt%2FV7M0jCuNIbn47AaES0XK%2FOgL6QbRcuBGPOw%3D',
            description: 'Deforestation-free Beef Rump Steak',
          },
        },
      },
    };

    await processTransformationEvent(data, context);
    expect(registerLinkResolver).toHaveBeenCalledTimes(4);
  });

  it('should throw error when issueVC throws error', async () => {
    try {
      await processTransformationEvent(null, null);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
    }
  });
});
