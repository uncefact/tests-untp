import { IdentificationKeyType, createLinkResolver, registerLinkResolver } from '../../build/linkResolver.service';
import { privateAPI } from '../../build/utils/httpService';

jest.mock('../../build/utils/httpService', () => ({
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
