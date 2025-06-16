export const mockCredential = {
  verifiableCredential: {
    '@context': [
      'https://www.w3.org/2018/credentials/v1',
      'https://w3id.org/vc-revocation-list-2020/v1',
      'https://w3id.org/security/suites/jws-2020/v1',
    ],
    type: ['VerifiableCredential'],
    issuer: {
      id: 'did:web:api.vckit.showthething.com',
    },
    credentialSubject: {
      pdfUrl: '',
      number: 'C-101507453',
      consignmentNumber: 'C-101507454',
      forms: [
        {
          serialNumber: '41384822',
          type: 'LPAC1',
        },
      ],
      movementDate: '2023-06-10T00:00:00',
      movementTime: '01:00',
      createdAt: '2023-10-30T08:18:49.810Z',
      updatedAt: '2023-10-30T08:18:49.810Z',
      submittedAt: '2023-10-30T08:18:49.810Z',
      origin: {
        name: 'AgTrace farms',
        pic: 'NH020188',
      },
      destination: {
        name: 'AgTrace processors',
        pic: 'QBZZ2222',
      },
      declaration: {
        accept: true,
        fullName: 'danny',
        phone: '0299999999',
        date: '2020-09-24T00:00:00',
        signature:
          'file:signature.png;data:image/png;base64,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',
        address: {
          line1: '123',
          town: 'Fake',
          state: 'NSW',
          postcode: '2000',
        },
        email: 'dan@da.com',
        certificateNumber: null,
      },
      answers: [
        {
          questionId: '3',
          value: '1',
          index: 0,
        },
        {
          questionId: '3',
          value: '2',
          index: 1,
        },
        {
          questionId: '4',
          value: 'Hereford',
          index: 0,
        },
        {
          questionId: '4',
          value: 'Hereford',
          index: 1,
        },
        {
          questionId: '5',
          value: 'Bull : M',
          index: 0,
        },
        {
          questionId: '5',
          value: 'Bull : M',
          index: 1,
        },
        {
          questionId: '8',
          value: 'No',
          index: 0,
        },
        {
          questionId: '8',
          value: 'No',
          index: 1,
        },
        {
          questionId: '10',
          value: 'NH020188LEJ00005',
          index: 0,
        },
        {
          questionId: '10',
          value: 'NH020188LEJ00012',
          index: 1,
        },
        {
          questionId: '15',
          value: '1',
          index: 0,
        },
        {
          questionId: '15',
          value: '2',
          index: 1,
        },
        {
          questionId: '16',
          value: '2',
          index: 1,
        },
        {
          questionId: '16',
          value: '1',
          index: 0,
        },
        {
          questionId: '17',
          value: 'No',
          index: null,
        },
        {
          questionId: '20',
          value: '6to12Months',
          index: null,
        },
        {
          questionId: '56',
          value: 'Yes',
          index: null,
        },
        {
          questionId: '57',
          value: '6month detail',
          index: null,
        },
        {
          questionId: '58',
          value: 'No',
          index: null,
        },
        {
          questionId: '59',
          value: 'Yes',
          index: null,
        },
        {
          questionId: '61',
          value: 'stock feed1',
          index: 0,
        },
        {
          questionId: '61',
          value: 'stock feed2',
          index: 1,
        },
        {
          questionId: '63',
          value: '2023-06-01',
          index: 0,
        },
        {
          questionId: '63',
          value: '2023-06-01',
          index: 1,
        },
        {
          questionId: '70',
          value: 'Yes',
          index: null,
        },
        {
          questionId: '72',
          value: 'material1',
          index: 0,
        },
        {
          questionId: '73',
          value: '2022-06-01',
          index: 0,
        },
        {
          questionId: '74',
          value: '123',
          index: 0,
        },
        {
          questionId: '75',
          value: '2022-06-17',
          index: 0,
        },
        {
          questionId: '76',
          value: '2023-06-18',
          index: 0,
        },
        {
          questionId: '88',
          value: 'No',
          index: null,
        },
        {
          questionId: '96',
          value: 'Yes',
          index: null,
        },
        {
          questionId: '98',
          value: 'chemprod1',
          index: 0,
        },
        {
          questionId: '99',
          value: '2023-06-01',
          index: 0,
        },
        {
          questionId: '100',
          value: '999',
          index: 0,
        },
        {
          questionId: '101',
          value: '555',
          index: 0,
        },
        {
          questionId: '102',
          value: 'Yes',
          index: null,
        },
        {
          questionId: '103',
          value: '2023-06-08',
          index: null,
        },
        {
          questionId: '158',
          value: 'Mr Transporter',
          index: 0,
        },
        {
          questionId: '158',
          value: 'Mrs Transporter',
          index: 1,
        },
        {
          questionId: '159',
          value: 'ABC123',
          index: 0,
        },
        {
          questionId: '159',
          value: 'XYZ987',
          index: 1,
        },
        {
          questionId: '160',
          value: '0291919191',
          index: 0,
        },
        {
          questionId: '160',
          value: '0212121212',
          index: 1,
        },
        {
          questionId: '162',
          value: '2023-06-15',
          index: 0,
        },
        {
          questionId: '162',
          value: '2023-06-01',
          index: 1,
        },
        {
          questionId: '163',
          value: '13:00',
          index: 0,
        },
        {
          questionId: '163',
          value: '13:00',
          index: 1,
        },
        {
          questionId: '164',
          value: 'True',
          index: 0,
        },
        {
          questionId: '164',
          value: 'True',
          index: 1,
        },
      ],
    },
    issuanceDate: '2023-10-30T08:18:51.864Z',
    proof: {
      type: 'JsonWebSignature2020',
      created: '2023-10-30T08:18:52Z',
      verificationMethod:
        'did:web:api.vckit.showthething.com#793a546194958d2cab66f4d80b11a029ca6a7f04209f0fa4003520d31543362c-key-0',
      proofPurpose: 'assertionMethod',
      jws: 'eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il19..W2FJVbKFjUOPgxggIkjTjzi5mAmJNVozbkjlUtYK0AK97uHpEh0p8oJaIsiwQ1_j7rqARJQgcIbRRIU4EV34Ag',
    },
  },
};
