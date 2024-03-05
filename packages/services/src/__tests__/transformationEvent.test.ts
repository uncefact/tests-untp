import {
  issueDPP,
  issueEpcisTransformationEvent,
  processTransformationEvent,
  uploadVC,
} from '../epcisEvents/transformationEvent';
import { issueVC, contextDefault } from '../vckit.service';
import { epcisTransformationCrendentialSubject } from '../epcis.service';
import { uploadJson } from '../storage.service';
import { registerLinkResolver, IdentificationKeyType } from '../linkResolver.service';
import { fillArray } from '../utils/helpers';
import { IInputItems } from '../epcisEvents/types';
import { contextTransformationEvent, dataTransformationEvent } from './mocks/constants';

jest.mock('../vckit.service', () => ({
  issueVC: jest.fn(),
  contextDefault: ['https://www.w3.org/2018/credentials/v1', 'https://w3id.org/vc-revocation-list-2020/v1'],
}));

jest.mock('../epcis.service', () => ({
  epcisTransformationCrendentialSubject: jest.fn(),
}));

jest.mock('../storage.service', () => ({
  uploadJson: jest.fn(),
}));

jest.mock('../linkResolver.service', () => ({
  registerLinkResolver: jest.fn(),
  IdentificationKeyType: {
    gtin: 'gtin',
    nlisid: 'nlisid',
  },
}));

describe('Transformation event', () => {
  describe('successful case', () => {
    afterEach(() => {
      jest.clearAllMocks();
    });

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
        const detailOfProducts: any = contextTransformationEvent.productTransformation.outputItems;
        const convertProductToObj = detailOfProducts.reduce((accumulator: any, item: any) => {
          accumulator[item.productID] = item;
          return accumulator;
        }, {});

        const outputItemList = detailOfProducts.map((itemOutput: any) => {
          return {
            productID: itemOutput,
            link: `${contextTransformationEvent.dlr.dlrAPIUrl}/gtin/${itemOutput}?linkType=gs1:certificationInfo`,
            name: convertProductToObj[itemOutput]?.productClass,
          };
        });

        const inputItemObj = inputItems?.map((item: string) => {
          return {
            productID: item,
            link: `${contextTransformationEvent.dlr.dlrAPIUrl}/nlisid/${item}?linkType=gs1:certificationInfo`,
            name: 'Cattle',
          };
        });

        const countInputItems = fillArray(inputItems, contextTransformationEvent.productTransformation.inputItems);

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
        contextTransformationEvent.vckit,
        contextTransformationEvent.epcisTransformationEvent,
        contextTransformationEvent.dlr,
        contextTransformationEvent.productTransformation,
        contextTransformationEvent.identifierKeyPaths,
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
          ...dataTransformationEvent,
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
      const detailOfOutputProducts = contextTransformationEvent.productTransformation.outputItems;
      detailOfOutputProducts.map(async (outputItem) => {
        vc = await issueDPP(
          contextTransformationEvent.vckit,
          contextTransformationEvent.dpp,
          dataTransformationEvent.data.NLIS.length,
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

      await processTransformationEvent(dataTransformationEvent, contextTransformationEvent);
      expect(registerLinkResolver).toHaveBeenCalledTimes(6);
    });
  });

  describe('error case', () => {
    afterEach(() => {
      jest.clearAllMocks();
    });

    it('should throw error when issueVC throws error', async () => {
      try {
        await processTransformationEvent(null, null);
      } catch (error: any) {
        expect(error).toBeInstanceOf(Error);
      }
    });

    it('should throw error when context is empty', async () => {
      const emptyContext = {
        vckit: {},
        dpp: {},
        dlr: {},
        storage: {},
        epcisTransformationEvent: {},
        identifiers: [],
        productTransformation: {},
      };
      try {
        await processTransformationEvent(dataTransformationEvent, emptyContext);
      } catch (error: any) {
        console.log(error.message);
        expect(error.message).not.toBeNull();
      }
    });

    it('should throw error when context is empty vckit field', async () => {
      const newContext = {
        ...contextTransformationEvent,
        vckit: {},
      };
      try {
        await processTransformationEvent(dataTransformationEvent, newContext);
      } catch (error: any) {
        console.log(error.message);
        expect(error.message).not.toBeNull();
      }
    });
    it('should throw error when context is empty dpp field', async () => {
      const newContext = {
        ...contextTransformationEvent,
        dpp: {},
      };
      try {
        await processTransformationEvent(dataTransformationEvent, newContext);
      } catch (error: any) {
        expect(error.message).toEqual('Error: Invalid dpp context');
      }
    });

    it('should throw error when context is empty dlr field', async () => {
      const newContext = {
        ...contextTransformationEvent,
        dlr: {},
      };
      try {
        await processTransformationEvent(dataTransformationEvent, newContext);
      } catch (error: any) {
        expect(error.message).toEqual('Error: Invalid dlr context');
      }
    });

    it('should throw error when context is empty epcisTransformationEvent field', async () => {
      const newContext = {
        ...contextTransformationEvent,
        epcisTransformationEvent: {},
      };
      try {
        await processTransformationEvent(dataTransformationEvent, newContext);
      } catch (error: any) {
        console.log(error.message);
        expect(error.message).not.toBeNull();
      }
    });

    it('should throw error when context is empty epcisTransformationEvent type field', async () => {
      const newContext = {
        ...contextTransformationEvent,
        epcisTransformationEvent: {
          ...contextTransformationEvent.epcisTransformationEvent,
          type: '',
        },
      };
      try {
        await processTransformationEvent(dataTransformationEvent, newContext);
      } catch (error: any) {
        expect(error.message).toEqual('Error: Invalid epcisTransformationEvent type');
      }
    });

    it('should throw error when context is empty productTransformation field', async () => {
      const newContext = {
        ...contextTransformationEvent,
        productTransformation: [],
      };
      try {
        await processTransformationEvent(dataTransformationEvent, newContext);
      } catch (error: any) {
        expect(error.message).toEqual('Error: Output Items not found');
      }
    });

    it('should throw error when context is empty productTransformation field', async () => {
      const newContext = {
        ...contextTransformationEvent,
        storage: [],
      };
      try {
        await processTransformationEvent(dataTransformationEvent, newContext);
      } catch (error: any) {
        expect(error.message).toEqual('Error: Invalid storage context');
      }
    });
  });
});
