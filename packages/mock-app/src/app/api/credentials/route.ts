// packages/mock-app/src/app/api/credentials/route.ts
import { NextResponse } from "next/server";

type IssueRequest = {
  serviceName: string;
  formData: Record<string, any>;
  publish?: boolean;
};

export async function POST(req: Request) {
  // get payload
  const body = (await req.json()) as IssueRequest;

  // get config from app-config.json -> hardcoded for now
  const config = getConfig(body);

  // issue credential with VCkit
  const signedCredential = await issueCredential(config, body);

  console.log("received signed credential: ", signedCredential)

  // register credential to storage service
  console.log("TODO: register credential to storage service")

  // Publish link with IDR if requested
  if (body.publish) {
    // if publish=true, register with IDR service
    // TODO
    console.log("TODO: register with IDR service")
  }

  return NextResponse.json({ ok: true });
}

async function issueCredential(config: any, body: IssueRequest) {
  const svc = config.services[0];
  const params = svc.parameters[0];

  const payload = {
    credential: {
      "@context": params.dpp.context,
      type: ["VerifiableCredential", ...params.dpp.type],
      issuer: params.vckit.issuer,
      credentialSubject: body.formData,
      renderMethod: params.dpp.renderTemplate,
      validUntil: params.dpp.validUntil,
      validFrom: params.dpp.validFrom,
    }
  };

  const res = await fetch(`${params.vckit.vckitAPIUrl}/credentials/issue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(params.vckit.headers ?? {}),
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`VCkit issue failed: ${res.status} ${text}`);
  }

  return res.json();
}

function getConfig(body: IssueRequest) {
  if (body.serviceName === "processDPP") {
    return {
      name: "Issue DPP",
      id: "produce_dpp",
      components: [
        {
          name: "JsonForm",
          type: "EntryData",
          props: {
            schema: {
              url: "https://jargon.sh/user/unece/DigitalProductPassport/v/0.6.0/artefacts/jsonSchemas/ProductPassport.json?class=ProductPassport"
            },
            data: {
              type: ["ProductPassport"],
              id: "example:product/1234",
              product: {
                type: ["Product"],
                id: "https://id.gs1.org/01/09359502000034/21/12345",
                name: "EV battery 300Ah",
                registeredId: "09359502000034",
                idScheme: {
                  type: ["IdentifierScheme"],
                  id: "https://id.gs1.org/01/",
                  name: "Global Trade Identification Number (GTIN)"
                },
                batchNumber: "6789",
                productImage: {
                  linkURL: "https://c.animaapp.com/b3vf2M20/img/pp-header@2x.png",
                  linkName: "GBA rule book conformity certificate",
                  linkType: "https://test.uncefact.org/vocabulary/linkTypes/dcc"
                },
                description: "400Ah 24v LiFePO4 battery",
                productCategory: [
                  {
                    type: ["Classification"],
                    id: "https://unstats.un.org/unsd/classifications/Econ/cpc/46410",
                    code: "46410",
                    name: "Primary cells and primary batteries",
                    schemeID: "https://unstats.un.org/unsd/classifications/Econ/cpc/",
                    schemeName: "UN Central Product Classification (CPC)"
                  }
                ],
                furtherInformation: [
                  {
                    linkURL: "https://files.example-certifier.com/1234567.json",
                    linkName: "GBA rule book conformity certificate",
                    linkType: "https://test.uncefact.org/vocabulary/linkTypes/dcc"
                  }
                ],
                producedByParty: {
                  id: "https://abr.business.gov.au/ABN/View?abn=90664869327",
                  name: "Example Company Pty Ltd.",
                  registeredId: "90664869327",
                  idScheme: {
                    type: ["IdentifierScheme"],
                    id: "https://id.gs1.org/01/",
                    name: "Global Trade Identification Number (GTIN)"
                  }
                },
                producedAtFacility: {
                  id: "https://example-facility-register.com/1234567",
                  name: "Greenacres battery factory",
                  registeredId: "1234567",
                  idScheme: {
                    type: ["IdentifierScheme"],
                    id: "https://id.gs1.org/01/",
                    name: "Global Trade Identification Number (GTIN)"
                  }
                },
                productionDate: "2024-04-25",
                countryOfProduction: "AU",
                serialNumber: "12345",
                dimensions: {
                  weight: {
                    value: 10,
                    unit: "KGM"
                  },
                  length: {
                    value: 10,
                    unit: "KGM"
                  },
                  width: {
                    value: 10,
                    unit: "KGM"
                  },
                  height: {
                    value: 10,
                    unit: "KGM"
                  },
                  volume: {
                    value: 10,
                    unit: "KGM"
                  }
                }
              },
              granularityLevel: "batch",
              conformityClaim: [
                {
                  type: ["Claim", "Declaration"],
                  id: "https://products.example-company.com/09520123456788/declarations/12345",
                  description: "A standardised disclosure of the battery's greenhouse gas emissions intensity, calculated in accordance with the Global Battery Alliance Battery Passport Greenhouse Gas Rulebook V.2.0.",
                  referenceStandard: {
                    type: ["Standard"],
                    id: "https://www.globalbattery.org/media/publications/gba-rulebook-v2.0-master.pdf",
                    name: "GBA Battery Passport Greenhouse Gas Rulebook - V.2.0",
                    issuingParty: {
                      id: "https://abr.business.gov.au/ABN/View?abn=90664869327",
                      name: "Example Company Pty Ltd.",
                      registeredId: "90664869327",
                      idScheme: {
                        type: ["IdentifierScheme"],
                        id: "https://id.gs1.org/01/",
                        name: "Global Trade Identification Number (GTIN)"
                      }
                    },
                    issueDate: "2023-12-05"
                  },
                  referenceRegulation: {
                    type: ["Regulation"],
                    id: "https://www.legislation.gov.au/F2008L02309/latest/versions",
                    name: "National Greenhouse and Energy Reporting (Measurement) Determination",
                    jurisdictionCountry: "AU",
                    administeredBy: {
                      id: "https://abr.business.gov.au/ABN/View?abn=90664869327",
                      name: "Example Company Pty Ltd.",
                      registeredId: "90664869327",
                      idScheme: {
                        type: ["IdentifierScheme"],
                        id: "https://id.gs1.org/01/",
                        name: "Global Trade Identification Number (GTIN)"
                      }
                    },
                    effectiveDate: "2024-03-20"
                  },
                  assessmentCriteria: [
                    {
                      type: ["Criterion"],
                      id: "https://www.globalbattery.org/media/publications/gba-rulebook-v2.0-master.pdf#BatteryAssembly",
                      name: "GBA Battery rule book v2.0 battery assembly guidelines.",
                      description: "Battery is designed for easy disassembly and recycling at end-of-life.",
                      conformityTopic: "social.rights",
                      status: "proposed",
                      subCriterion: [],
                      thresholdValue: {
                        metricName: "GHG emissions intensity",
                        metricValue: {
                          value: 10,
                          unit: "KGM"
                        },
                        score: "BB",
                        accuracy: 0.05
                      },
                      performanceLevel: "\"Category 3 recyclable with 73% recyclability\"",
                      tags: "The quick brown fox jumps over the lazy dog."
                    }
                  ],
                  assessmentDate: "2024-03-15",
                  declaredValue: [
                    {
                      metricName: "GHG emissions intensity",
                      metricValue: {
                        value: 10,
                        unit: "KGM"
                      },
                      score: "BB",
                      accuracy: 0.05
                    }
                  ],
                  conformance: true,
                  conformityTopic: "environment.emissions",
                  conformityEvidence: {
                    linkURL: "https://files.example-certifier.com/1234567.json",
                    linkName: "GBA rule book conformity certificate",
                    linkType: "https://test.uncefact.org/vocabulary/linkTypes/dcc",
                    hashDigest: "6239119dda5bd4c8a6ffb832fe16feaa5c27b7dba154d24c53d4470a2c69adc2",
                    hashMethod: "SHA-256",
                    encryptionMethod: "AES"
                  }
                }
              ],
              emissionsScorecard: {
                carbonFootprint: 1.8,
                declaredUnit: "KGM",
                operationalScope: "CradleToGate",
                primarySourcedRatio: 0.3,
                reportingStandard: {
                  type: ["Standard"],
                  id: "https://www.globalbattery.org/media/publications/gba-rulebook-v2.0-master.pdf",
                  name: "GBA Battery Passport Greenhouse Gas Rulebook - V.2.0",
                  issuingParty: {
                    id: "https://abr.business.gov.au/ABN/View?abn=90664869327",
                    name: "Example Company Pty Ltd.",
                    registeredId: "90664869327",
                    idScheme: {
                      type: ["IdentifierScheme"],
                      id: "https://id.gs1.org/01/",
                      name: "Global Trade Identification Number (GTIN)"
                    }
                  },
                  issueDate: "2023-12-05"
                }
              },
              traceabilityInformation: [
                {
                  valueChainProcess: "Spinning",
                  verifiedRatio: 0.5,
                  traceabilityEvent: [
                    {
                      linkURL: "https://files.example-certifier.com/1234567.json",
                      linkName: "GBA rule book conformity certificate",
                      linkType: "https://test.uncefact.org/vocabulary/linkTypes/dcc",
                      hashDigest: "6239119dda5bd4c8a6ffb832fe16feaa5c27b7dba154d24c53d4470a2c69adc2",
                      hashMethod: "SHA-256",
                      encryptionMethod: "AES"
                    }
                  ]
                }
              ],
              circularityScorecard: {
                recyclingInformation: {
                  linkURL: "https://files.example-certifier.com/1234567.json",
                  linkName: "GBA rule book conformity certificate",
                  linkType: "https://test.uncefact.org/vocabulary/linkTypes/dcc"
                },
                repairInformation: {
                  linkURL: "https://files.example-certifier.com/1234567.json",
                  linkName: "GBA rule book conformity certificate",
                  linkType: "https://test.uncefact.org/vocabulary/linkTypes/dcc"
                },
                recyclableContent: 0.5,
                recycledContent: 0.3,
                utilityFactor: 1.2,
                materialCircularityIndicator: 0.67
              },
              dueDiligenceDeclaration: {
                linkURL: "https://files.example-certifier.com/1234567.json",
                linkName: "GBA rule book conformity certificate",
                linkType: "https://test.uncefact.org/vocabulary/linkTypes/dcc"
              },
              materialsProvenance: [
                {
                  name: "Lithium Spodumene",
                  originCountry: "AU",
                  materialType: {
                    type: ["Classification"],
                    id: "https://unstats.un.org/unsd/classifications/Econ/cpc/46410",
                    code: "46410",
                    name: "Primary cells and primary batteries",
                    schemeID: "https://unstats.un.org/unsd/classifications/Econ/cpc/",
                    schemeName: "UN Central Product Classification (CPC)"
                  },
                  massFraction: 0.2,
                  mass: {
                    value: 10,
                    unit: "KGM"
                  },
                  recycledMassFraction: 0.5,
                  hazardous: false,
                  symbol: "undefined",
                  materialSafetyInformation: {
                    linkURL: "https://files.example-certifier.com/1234567.json",
                    linkName: "GBA rule book conformity certificate",
                    linkType: "https://test.uncefact.org/vocabulary/linkTypes/dcc"
                  }
                }
              ]
            }
          }
        },
        {
          name: "CustomButton",
          type: "Submit",
          props: {
            label: "Issue DPP",
            description: "",
            includeDownload: false,
            downloadFileName: ""
          }
        }
      ],
      services: [
        {
          name: "processDPP",
          parameters: [
            {
              vckit: {
                vckitAPIUrl: "http://localhost:3332/v2",
                issuer: {
                  type: ["CredentialIssuer"],
                  id: "did:web:uncefact.github.io:project-vckit:test-and-development",
                  name: "Example Company Pty Ltd",
                  issuerAlsoKnownAs: [
                    {
                      id: "https://abr.business.gov.au/ABN/View?abn=90664869327",
                      name: "Example Company Pty Ltd.",
                      registeredId: "90664869327",
                      idScheme: {
                        type: ["IdentifierScheme"],
                        id: "https://abr.business.gov.au/ABN/",
                        name: "Australian Business Number (ABN)"
                      }
                    }
                  ]
                },
                headers: {
                  Authorization: "Bearer test123"
                }
              },
              dpp: {
                validUntil: "2026-11-28T04:47:15.136Z",
                context: [
                  "https://www.w3.org/ns/credentials/v2",
                  "https://test.uncefact.org/vocabulary/untp/dpp/0.6.0/"
                ],
                renderTemplate: [
                  {
                    type: "WebRenderingTemplate2022",
                    template: "<html></html>"
                      }
                ],
                type: ["DigitalProductPassport"],
                dlrLinkTitle: "Product Passport",
                dlrVerificationPage: "http://localhost:3003/verify"
              },
              dlr: {
                dlrAPIUrl: "http://localhost:3000/api/1.0.0",
                dlrAPIKey: "test123",
                namespace: "gs1",
                linkRegisterPath: "resolver"
              },
              storage: {
                url: "http://localhost:3334/api/1.0.0/documents",
                params: {
                  bucket: "verifiable-credentials"
                },
                options: {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json"
                  }
                }
              },
              identifierKeyPath: "/product/id"
            }
          ]
        }
      ]
    };
  }

  throw new Error(`Unsupported service: ${body.serviceName}`);
}
