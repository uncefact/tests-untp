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
  const context = {
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
    identifiers: ['9359502000034', '9359502000010'],
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

  const data = {
    data: {
      NLIS: ['NH020188LEJ00012', 'NH020188LEJ00013'],
      product: {
        manufacturer: {
          name: "Pete's Meats",
        },
      },
    },
  };

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

    (epcisTransformationCrendentialSubject as jest.Mock).mockImplementation((inputItems) => {
      const detailOfProducts: any = context.productTransformation.outputItems;
      const convertProductToObj = detailOfProducts.reduce((accumulator, item, index) => {
        accumulator[item.productID] = item;
        return accumulator;
      }, {});

      const outputItemList = detailOfProducts.map((itemOutput: any) => {
        return {
          productID: itemOutput,
          link: `${context.dlr.dlrAPIUrl}/gtin/${itemOutput}?linkType=gs1:certificationInfo`,
          name: convertProductToObj[itemOutput]?.productClass,
        };
      });

      const inputItemObj = inputItems?.map((item: string) => {
        return {
          productID: item,
          link: `${context.dlr.dlrAPIUrl}/nlisid/${item}?linkType=gs1:certificationInfo`,
          name: 'Cattle',
        };
      });

      const countInputItems = fillArray(inputItems, context.productTransformation.inputItems);

      return {
        eventID: '1234',
        eventType: 'Transformation',
        eventTime: 'Mon, 20 Feb 2023 8:26:54 GMT',
        actionCode: 'observe',
        dispositionCode: 'active',
        businessStepCode: 'packing',
        readPointId: '48585',
        locationId: 'https://plus.codes/4RRG6MJF+C6X',
        inputItemList: inputItemObj,
        inputQuantityList: countInputItems.map((item: IInputItems) => ({
          productClass: item.productClass,
          quantity: item.quantity,
          uom: item.uom,
        })),
        outputItemList,
      };
    });

    const vc = await issueEpcisTransformationEvent(
      context.vckit,
      context.epcisTransformationEvent,
      context.dlr,
      data,
      context.productTransformation,
      context.identifierKeyPaths,
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
    const newData = {
      data: {
        ...data,
        product: {
          manufacturer: {
            name: "Pete's Meats",
          },
        },
      },
    };
    (issueVC as jest.Mock).mockImplementation((value) => {
      console.log('issueDPP', JSON.stringify(value));

      expectResult = {
        '@context': [...contextDefault, ...value.context],
        type: ['VerifiableCredential', ...value.type],
        issuer: {
          id: value.issuer,
        },
        // credentialSubject: value.credentialSubject, // TODO: currently, the value in credentialSubject will be overwritten by the last identifier
        render: value.render,
      };

      return Promise.resolve({ ...expectResult });
    });

    let vc = {};
    const detailOfOutputProducts = context.productTransformation.outputItems;
    detailOfOutputProducts.map(async (outputItem) => {
      vc = await issueDPP(
        context.vckit,
        context.dpp,
        data.data.NLIS.length,
        `http://localhost/gtin/${outputItem.productID}?linkType=all`,
        newData,
        outputItem,
      );

      expect(vc).toEqual(expectResult);
    });
  });

  it('should throw error when issue DPP with gtin is invalid', async () => {
    try {
      const mockVc = {
        issuer: '',
        vckitAPIUrl: '',
      };

      const mockDpp = {
        context: [],
        renderTemplate: [],
        type: [''],
      };

      await issueDPP(mockVc, mockDpp, 0, '', { inputItems: [], outputItems: [] }, {});
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
        console.log({
          url,
          linkTitle,
          verificationPage,
          dlrAPIKey,
          qualifierPath,
          identificationKey,
        });
        return `${dlrAPIUrl}/${identificationKeyType}/${identificationKey}?linkType=all`;
      },
    );

    await processTransformationEvent(data, context);
    expect(registerLinkResolver).toHaveBeenCalledTimes(6);
  });

  it('should throw error when issueVC throws error', async () => {
    try {
      await processTransformationEvent(null, null);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
    }
  });
});
