"use strict";(self.webpackChunkdocumentation=self.webpackChunkdocumentation||[]).push([[4129],{8481:(e,n,t)=>{t.d(n,{Ay:()=>a,RM:()=>r});var i=t(4848),s=t(8453);const r=[];function o(e){const n={admonition:"admonition",p:"p",...(0,s.R)(),...e.components};return(0,i.jsx)(n.admonition,{type:"info",children:(0,i.jsx)(n.p,{children:"Please note that this content is under development and is not ready for implementation. This status message will be updated as content development progresses."})})}function a(e={}){const{wrapper:n}={...(0,s.R)(),...e.components};return n?(0,i.jsx)(n,{...e,children:(0,i.jsx)(o,{...e})}):o(e)}},4906:(e,n,t)=>{t.r(n),t.d(n,{assets:()=>d,contentTitle:()=>a,default:()=>h,frontMatter:()=>o,metadata:()=>c,toc:()=>l});var i=t(4848),s=t(8453),r=t(8481);const o={sidebar_position:25,title:"Process Transformation Event"},a=void 0,c={id:"mock-apps/services/process-transformation-event",title:"Process Transformation Event",description:"Description",source:"@site/docs/mock-apps/services/process-transformation-event.md",sourceDirName:"mock-apps/services",slug:"/mock-apps/services/process-transformation-event",permalink:"/tests-untp/docs/mock-apps/services/process-transformation-event",draft:!1,unlisted:!1,editUrl:"https://github.com/uncefact/tests-untp/tree/main/docs/mock-apps/services/process-transformation-event.md",tags:[],version:"current",sidebarPosition:25,frontMatter:{sidebar_position:25,title:"Process Transformation Event"},sidebar:"tutorialSidebar",previous:{title:"Process Transaction Event",permalink:"/tests-untp/docs/mock-apps/services/process-transaction-event"},next:{title:"Process Object Event",permalink:"/tests-untp/docs/mock-apps/services/process-object-event"}},d={},l=[...r.RM,{value:"Description",id:"description",level:2},{value:"Diagram",id:"diagram",level:2},{value:"Example",id:"example",level:2},{value:"Definitions",id:"definitions",level:2}];function p(e){const n={a:"a",code:"code",h2:"h2",mermaid:"mermaid",p:"p",pre:"pre",table:"table",tbody:"tbody",td:"td",th:"th",thead:"thead",tr:"tr",...(0,s.R)(),...e.components};return(0,i.jsxs)(i.Fragment,{children:[(0,i.jsx)(r.Ay,{}),"\n",(0,i.jsx)(n.h2,{id:"description",children:"Description"}),"\n",(0,i.jsxs)(n.p,{children:["The ",(0,i.jsx)(n.code,{children:"processTransformationEvent"})," service is responsible for processing a ",(0,i.jsx)(n.a,{href:"https://uncefact.github.io/spec-untp/docs/specification/DigitalTraceabilityEvents",children:"Transformation Event (DTE)"}),", issuing ",(0,i.jsx)(n.a,{href:"https://uncefact.github.io/spec-untp/docs/specification/VerifiableCredentials",children:"Verifiable Credentials (VCs)"})," for both the Transformation Event and ",(0,i.jsx)(n.a,{href:"https://uncefact.github.io/spec-untp/docs/specification/DigitalProductPassport",children:"Digital Product Passports (DPPs)"}),", uploading them to the ",(0,i.jsx)(n.a,{href:"/docs/mock-apps/dependent-services/storage-service",children:"Storage service"}),", registering the link to the stored DTE and DPPs with the ",(0,i.jsx)(n.a,{href:"/docs/mock-apps/dependent-services/identity-resolution-service",children:"Identity Resolver service"}),", and managing Transaction events in local storage associated with the event. It handles the entire lifecycle of creating and managing transformation events and associated DPPs."]}),"\n",(0,i.jsx)(n.h2,{id:"diagram",children:"Diagram"}),"\n",(0,i.jsx)(n.mermaid,{value:"sequenceDiagram\nparticipant C as Client\nparticipant P as processTransformationEvent\nparticipant V as VCKit\nparticipant S as Storage\nparticipant D as DLR\nC->>P: Call processTransformationEvent(data, context)\nP->>P: Validate context\nP->>V: Issue EPCIS VC\nV--\x3e>P: Return EPCIS VC\nP->>S: Upload EPCIS VC\nS--\x3e>P: Return EPCIS VC URL\nP->>D: Register EPCIS link resolver\nD--\x3e>P: Return EPCIS resolver URL\nloop For each output item\nP->>V: Issue DPP VC\nV--\x3e>P: Return DPP VC\nP->>S: Upload DPP VC\nS--\x3e>P: Return DPP VC URL\nP->>D: Register DPP link resolver\nD--\x3e>P: Return DPP resolver URL\nend\nP--\x3e>C: Return EPCIS VC"}),"\n",(0,i.jsx)(n.h2,{id:"example",children:"Example"}),"\n",(0,i.jsx)(n.pre,{children:(0,i.jsx)(n.code,{className:"language-json",children:'{\n  "name": "processTransformationEvent",\n  "parameters": [\n    {\n      "vckit": {\n        "vckitAPIUrl": "http://localhost:3332/v2",\n        "issuer": "did:web:uncefact.github.io:project-vckit:test-and-development",\n        "headers": {\n          "Authorization": "Bearer test123"\n        }\n      },\n      "epcisTransformationEvent": {\n        "context": ["https://www.w3.org/2018/credentials/v1", "https://gs1.org/voc/"],\n        "type": ["DigitalTraceabilityEvent"],\n        "renderTemplate": [\n          {\n            "type": "html",\n            "template": "<div><h2>Transformation Event</h2><p>Output: {{outputItems.0.epc}}</p></div>"\n          }\n        ],\n        "dlrIdentificationKeyType": "gtin",\n        "dlrLinkTitle": "Transformation Event",\n        "dlrVerificationPage": "https://verify.example.com"\n      },\n      "dlr": {\n        "dlrAPIUrl": "https://dlr.example.com/api",\n        "dlrAPIKey": "dlr-api-key-12345",\n        "namespace": "gs1",\n        "linkRegisterPath": "/api/resolver"\n      },\n      "storage": {\n        "url": "http://localhost:3334/v1/documents",\n        "params": {\n          "resultPath": "/uri",\n          "bucket": "verifiable-credentials"\n        },\n        "options": {\n          "method": "POST",\n          "headers": {\n            "Content-Type": "application/json"\n          }\n        }\n      },\n      "dpp": {\n        "context": ["https://www.w3.org/2018/credentials/v1", "https://schema.org/"],\n        "type": ["DigitalProductPassport"],\n        "renderTemplate": [\n          {\n            "type": "html",\n            "template": "<div><h2>Product DPP</h2><p>EPC: {{epc}}</p></div>"\n          }\n        ],\n        "dlrIdentificationKeyType": "gtin",\n        "dlrLinkTitle": "Product DPP",\n        "dlrVerificationPage": "https://verify.example.com"\n      },\n      "dppCredentials": [\n        {\n          "mappingFields": [\n            {\n              "sourcePath": "/vc/credentialSubject/outputItems/0/epc",\n              "destinationPath": "/epc"\n            }\n          ]\n        }\n      ],\n      "identifierKeyPath": "/outputItems/0/epc",\n      "transformationEventCredential": {\n        "mappingFields": [\n          {\n            "sourcePath": "/inputItems",\n            "destinationPath": "/inputQuantityList"\n          },\n          {\n            "sourcePath": "/outputItems",\n            "destinationPath": "/outputQuantityList"\n          }\n        ],\n        "generationFields": [\n          {\n            "path": "/eventTime",\n            "handler": "generateCurrentDatetime"\n          },\n          {\n            "path": "/eventID",\n            "handler": "generateUUID"\n          }\n        ]\n      }\n    }\n  ]\n}\n'})}),"\n",(0,i.jsx)(n.h2,{id:"definitions",children:"Definitions"}),"\n",(0,i.jsxs)(n.table,{children:[(0,i.jsx)(n.thead,{children:(0,i.jsxs)(n.tr,{children:[(0,i.jsx)(n.th,{children:"Property"}),(0,i.jsx)(n.th,{children:"Required"}),(0,i.jsx)(n.th,{children:"Description"}),(0,i.jsx)(n.th,{children:"Type"})]})}),(0,i.jsxs)(n.tbody,{children:[(0,i.jsxs)(n.tr,{children:[(0,i.jsx)(n.td,{children:"vckit"}),(0,i.jsx)(n.td,{children:"Yes"}),(0,i.jsx)(n.td,{children:"Configuration for the VCKit service"}),(0,i.jsx)(n.td,{children:(0,i.jsx)(n.a,{href:"/docs/mock-apps/common/vckit",children:"VCKit"})})]}),(0,i.jsxs)(n.tr,{children:[(0,i.jsx)(n.td,{children:"epcisTransformationEvent"}),(0,i.jsx)(n.td,{children:"Yes"}),(0,i.jsx)(n.td,{children:"Configuration for the EPCIS Transformation Event"}),(0,i.jsx)(n.td,{children:(0,i.jsx)(n.a,{href:"/docs/mock-apps/common/credential",children:"Credential"})})]}),(0,i.jsxs)(n.tr,{children:[(0,i.jsx)(n.td,{children:"dlr"}),(0,i.jsx)(n.td,{children:"Yes"}),(0,i.jsx)(n.td,{children:"Configuration for the Digital Link Resolver"}),(0,i.jsx)(n.td,{children:(0,i.jsx)(n.a,{href:"/docs/mock-apps/common/idr",children:"IDR"})})]}),(0,i.jsxs)(n.tr,{children:[(0,i.jsx)(n.td,{children:"storage"}),(0,i.jsx)(n.td,{children:"Yes"}),(0,i.jsx)(n.td,{children:"Configuration for storage service"}),(0,i.jsx)(n.td,{children:(0,i.jsx)(n.a,{href:"/docs/mock-apps/common/storage",children:"Storage"})})]}),(0,i.jsxs)(n.tr,{children:[(0,i.jsx)(n.td,{children:"dpp"}),(0,i.jsx)(n.td,{children:"Yes"}),(0,i.jsx)(n.td,{children:"Configuration for the Digital Product Passport"}),(0,i.jsx)(n.td,{children:(0,i.jsx)(n.a,{href:"/docs/mock-apps/common/credential",children:"Credential"})})]}),(0,i.jsxs)(n.tr,{children:[(0,i.jsx)(n.td,{children:"dppCredentials"}),(0,i.jsx)(n.td,{children:"Yes"}),(0,i.jsx)(n.td,{children:"Mapping configuration for DPP credentials"}),(0,i.jsxs)(n.td,{children:[(0,i.jsx)(n.a,{href:"/docs/mock-apps/common/construct-data",children:"Construct Data"}),"[]"]})]}),(0,i.jsxs)(n.tr,{children:[(0,i.jsx)(n.td,{children:"identifierKeyPath"}),(0,i.jsx)(n.td,{children:"Yes"}),(0,i.jsx)(n.td,{children:"JSON path to the identifier in the credential subject or the object for function and arguments of JSON path to construct identifier"}),(0,i.jsx)(n.td,{children:(0,i.jsx)(n.a,{href:"/docs/mock-apps/common/identifier-key-path",children:"IdentifierKeyPath"})})]}),(0,i.jsxs)(n.tr,{children:[(0,i.jsx)(n.td,{children:"transformationEventCredential"}),(0,i.jsx)(n.td,{children:"Yes"}),(0,i.jsx)(n.td,{children:"Mapping and generation configuration for the transformation event credential"}),(0,i.jsx)(n.td,{children:(0,i.jsx)(n.a,{href:"/docs/mock-apps/common/construct-data",children:"Construct Data"})})]})]})]})]})}function h(e={}){const{wrapper:n}={...(0,s.R)(),...e.components};return n?(0,i.jsx)(n,{...e,children:(0,i.jsx)(p,{...e})}):p(e)}},8453:(e,n,t)=>{t.d(n,{R:()=>o,x:()=>a});var i=t(6540);const s={},r=i.createContext(s);function o(e){const n=i.useContext(r);return i.useMemo((function(){return"function"==typeof e?e(n):{...n,...e}}),[n,e])}function a(e){let n;return n=e.disableParentContext?"function"==typeof e.components?e.components(s):e.components||s:o(e.components),i.createElement(r.Provider,{value:n},e.children)}}}]);