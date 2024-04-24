import { IdentificationKeyType, createLinkResolver, getLinkResolverIdentifier, registerLinkResolver } from '../linkResolver.service';
import { privateAPI } from '../utils/httpService';

jest.mock('../utils/httpService', () => ({
  privateAPI: {
    post: jest.fn(),
    setBearerTokenAuthorizationHeaders: jest.fn(),
  },
}));

describe('create link resolve service', () => {
  it('should return url when creating link resolver', async () => {
    let expectParamsCallAPI: any;
    jest.spyOn(privateAPI, 'post').mockImplementation((value, params) => {
      expectParamsCallAPI = params;
      return Promise.resolve({});
    });

    let expectToken = '';
    jest.spyOn(privateAPI, 'setBearerTokenAuthorizationHeaders' as any).mockImplementation((token) => {
      expectToken = token as string;
      return Promise.resolve({});
    });

    const mockValue = {
      eventLink: 'https://localhost/epcis-transformation-event/1234',
      identificationKeyType: IdentificationKeyType.nlisid,
      identificationKey: 'gtin-key',
      itemDescription: 'EPCIS transformation event VC',
      verificationPage: 'https://verify.com/dev/verifyCredential',
      dlrAPIUrl: 'https://dlr.com',
      dlrAPIKey: 'dlr-key',
      qualifierPath: '',
    };

    const resolverUrl = await registerLinkResolver(
      mockValue.eventLink,
      mockValue.identificationKeyType,
      mockValue.identificationKey,
      mockValue.itemDescription,
      mockValue.verificationPage,
      mockValue.dlrAPIUrl,
      mockValue.dlrAPIKey,
    );

    expect(resolverUrl).toEqual(
      `${mockValue.dlrAPIUrl}/${mockValue.identificationKeyType}/${mockValue.identificationKey}?linkType=all`,
    );
    expect(mockValue.identificationKeyType).toEqual(expectParamsCallAPI[0].identificationKeyType);
    expect(mockValue.identificationKey).toEqual(expectParamsCallAPI[0].identificationKey);
    expect(mockValue.itemDescription).toEqual(expectParamsCallAPI[0].itemDescription);
    expect(mockValue.verificationPage).toEqual(expectParamsCallAPI[0].responses[0].targetUrl);
    expect(mockValue.dlrAPIKey).toEqual(expectToken);
  });

  it('should throw error when creating link resolver', async () => {
    const errorMessage = 'Error creating link resolver';
    try {
      privateAPI.post = jest.fn().mockRejectedValueOnce(new Error(errorMessage));
      await createLinkResolver({
        linkResolver: {
          identificationKeyType: IdentificationKeyType.nlisid,
          identificationKey: 'gtin-key',
          itemDescription: 'EPCIS transformation event VC',
        },
        linkResponses: [],
        qualifierPath: '',
        dlrAPIUrl: 'https://dlr.com',
        dlrAPIKey: 'dlr-key',
      });
    } catch (error: any) {
      expect(error.message).toEqual(errorMessage);
    }
  });
});

describe('getLinkResolverIdentifier', () => {
  it('should extract identifier and qualifier path from an gtin AI', () => {
    const { identifier, qualifierPath } = getLinkResolverIdentifier([
      { ai: '01', value: '09359502000010' }
    ]);

    expect(identifier).toBe('09359502000010');
    expect(qualifierPath).toBe('');
  });

  it('should extract identifier and qualifier path from a combined multi AIs', () => {
    const { identifier, qualifierPath } = getLinkResolverIdentifier([
      { ai: '01', value: '09359502000010' },
      { ai: '10', value: 'ABC123' }
    ]);

    expect(identifier).toBe('09359502000010');
    expect(qualifierPath).toBe('/10/ABC123');
  });

  it('should throw an invalid DLR AIs error if input is empty array', () => {
    expect(() => getLinkResolverIdentifier([])).toThrow('Invalid DLR AIs. At least one DLR AI is required to resolve the identifier.');
  });

  it('should throw an invalid DLR AIs error if input 01 and 8006 are primary keys present at the same time.', () => {
    expect(() => getLinkResolverIdentifier([
      { ai: '01', value: '09359502000010' },
      { ai: '8006', value: 'ABC123' }
    ])).toThrow('Invalid DLR AIs. Both 01 and 8006 are primary keys and cannot be present at the same time.');
  });
});