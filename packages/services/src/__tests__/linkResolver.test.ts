import {
  IdentificationKeyType,
  LinkType,
  createLinkResolver,
  getLinkResolverIdentifier,
  registerLinkResolver,
} from '../linkResolver.service';
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
      identificationKeyNamespace: 'gtin',
      identificationKeyType: IdentificationKeyType.nlisid,
      identificationKey: 'gtin-key',
      itemDescription: 'EPCIS transformation event VC',
      verificationPage: 'https://verify.com/dev/verifyCredential',
      linkType: LinkType.epcisLinkType,
      dlrAPIUrl: 'https://dlr.com',
      dlrAPIKey: 'dlr-key',
      namespace: 'gtin',
      qualifierPath: '',
    };

    const resolverUrl = await registerLinkResolver(
      mockValue.eventLink,
      mockValue.namespace,
      mockValue.identificationKeyType,
      mockValue.identificationKey,
      mockValue.itemDescription,
      mockValue.linkType,
      mockValue.verificationPage,
      mockValue.dlrAPIUrl,
      mockValue.dlrAPIKey,
      mockValue.namespace,
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
          identificationKeyNamespace: 'gtin',
          identificationKeyType: IdentificationKeyType.nlisid,
          identificationKey: 'gtin-key',
          itemDescription: 'EPCIS transformation event VC',
        },
        linkResponses: [],
        qualifierPath: '',
        dlrAPIUrl: 'https://dlr.com',
        dlrAPIKey: 'dlr-key',
        namespace: 'gtin',
      });
    } catch (error: any) {
      expect(error.message).toEqual(errorMessage);
    }
  });
});

describe('getLinkResolverIdentifier', () => {
  it('should correctly handle element strings with only identifier AIs', () => {
    const { identifier, qualifierPath } = getLinkResolverIdentifier('0109359502000010');

    expect(identifier).toBe('09359502000010');
    expect(qualifierPath).toBe('');
  });

  it('should correctly handle element strings with both identifier and qualifier AIs', () => {
    const { identifier, qualifierPath } = getLinkResolverIdentifier('010935950200001010ABC123');

    expect(identifier).toBe('09359502000010');
    expect(qualifierPath).toBe('/10/ABC123');
  });

  it('should correctly handle element strings with identifier and query strings', () => {
    const { identifier, qualifierPath } = getLinkResolverIdentifier('01093595020000103103000189');

    expect(identifier).toBe('09359502000010');
    expect(qualifierPath).toBe('?3103=000189');
  });

  it('should correctly handle element strings with complex combinations of AIs', () => {
    const { identifier, qualifierPath } = getLinkResolverIdentifier('0109359502000010310300018910ABC123');

    expect(identifier).toBe('09359502000010');
    expect(qualifierPath).toBe('/10/ABC123?3103=000189');
  });

  it('should throw an error when the element string does not contain exactly one primary identification key', () => {
    expect(() => getLinkResolverIdentifier('10ABCDEF')).toThrow(
      'getLinkResolverIdentifier Error: ===> analyseuri ERROR ===> The element string should contain exactly one primary identification key - it contained 0 []; please check for a syntax error.',
    );
  });

  it('should throw an error when the element string contains invalid syntax', () => {
    expect(() => getLinkResolverIdentifier('01093595')).toThrow('SYNTAX ERROR: invalid syntax for value of (01)093595');
  });

  it('should throw an error when the element string contains two primary AI codes', () => {
    const gtin = '01';
    const gtinValue = '09359502000010';
    const itip = '8006';
    const itipValue = '123456789012315678';
    const elementString = `${gtin}${gtinValue}${itip}${itipValue}`;

    expect(() => getLinkResolverIdentifier(elementString)).toThrow(
      'getLinkResolverIdentifier Error: ===> analyseuri ERROR ===> The element string should contain exactly one primary identification key - ' +
        `it contained 2 [${JSON.stringify({ ai: itip, value: itipValue })},${JSON.stringify({
          ai: gtin,
          value: gtinValue,
        })}]; please check for a syntax error.`,
    );
  });
});
