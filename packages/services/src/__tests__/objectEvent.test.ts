import { processObjectEvent } from '../../build/epcisEvents/objectEvent';
import { issueVC, contextDefault } from '../../build/vckit.service';
import { uploadJson } from '../../build/storage.service';
import { registerLinkResolver } from '../../build/linkResolver.service';
import { IdentificationKeyType } from '../linkResolver.service';

jest.mock('../../build/vckit.service', () => ({
  issueVC: jest.fn(),
  contextDefault: ['https://www.w3.org/2018/credentials/v1', 'https://w3id.org/vc-revocation-list-2020/v1'],
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

describe('processObjectEvent', () => {
  const data = {
    data: {
      herd: {
        NLIS: 'NH020188LEJ00012',
      },
    },
  };
  const context = {
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

  let expectVCResult = {};
  beforeAll(() => {
    (issueVC as jest.Mock).mockImplementation((value) => {
      expectVCResult = {
        '@context': [...contextDefault, ...value.context],
        type: ['VerifiableCredential', ...value.type],
        issuer: {
          id: value.issuer,
        },
        credentialSubject: value.credentialSubject,
        render: value.render,
      };

      return Promise.resolve(expectVCResult);
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should call process object event and issue vc', async () => {
    const vc = await processObjectEvent(data, context);
    expect(vc).toEqual(expectVCResult);
  });

  it('should call process object event and upload json', async () => {
    (uploadJson as jest.Mock).mockImplementation(({ filename, bucket }: { filename: string; bucket: string }) => {
      return `https://${bucket}.s3.ap-southeast-2.amazonaws.com/${filename}`;
    });

    await processObjectEvent(data, context);
    expect(uploadJson).toHaveBeenCalledWith({
      filename: expect.any(String),
      json: expectVCResult,
      bucket: context.storage.bucket,
      storageAPIUrl: context.storage.storageAPIUrl,
    });
  });

  it('should process object event and register link resolver', async () => {
    (registerLinkResolver as jest.Mock).mockImplementation(
      (
        url,
        identificationKeyType: IdentificationKeyType,
        identificationKey: string,
        linkTitle,
        verificationPage,
        dlrAPIUrl: string,
        dlrAPIKey,
      ) => {
        console.log({
          url,
          linkTitle,
          verificationPage,
          dlrAPIKey,
          identificationKey,
        });
        return `${dlrAPIUrl}/${identificationKeyType}/${identificationKey}?linkType=all`;
      },
    );

    await processObjectEvent(data, context);
    expect(registerLinkResolver).toHaveBeenCalled();

    const dppContext = context.dpp;
    const dlrContext = context.dlr;
    expect(registerLinkResolver).toHaveBeenCalledWith(
      expect.any(String),
      dppContext.dlrIdentificationKeyType,
      data.data.herd.NLIS,
      dppContext.dlrLinkTitle,
      dppContext.dlrVerificationPage,
      dlrContext.dlrAPIUrl,
      dlrContext.dlrAPIKey,
    );
  });
});
