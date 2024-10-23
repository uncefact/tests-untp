"use strict";(self.webpackChunkdocumentation=self.webpackChunkdocumentation||[]).push([[2892],{8481:(e,t,i)=>{i.d(t,{Ay:()=>a,RM:()=>s});var n=i(4848),r=i(8453);const s=[];function o(e){const t={admonition:"admonition",p:"p",...(0,r.R)(),...e.components};return(0,n.jsx)(t.admonition,{type:"info",children:(0,n.jsx)(t.p,{children:"Please note that this content is under development and is not ready for implementation. This status message will be updated as content development progresses."})})}function a(e={}){const{wrapper:t}={...(0,r.R)(),...e.components};return t?(0,n.jsx)(t,{...e,children:(0,n.jsx)(o,{...e})}):o(e)}},4085:(e,t,i)=>{i.r(t),i.d(t,{assets:()=>c,contentTitle:()=>a,default:()=>m,frontMatter:()=>o,metadata:()=>d,toc:()=>l});var n=i(4848),r=i(8453),s=i(8481);const o={sidebar_position:53,title:"Process Digital Conformity Credential"},a=void 0,d={id:"mock-apps/services/process-digital-conformity-credential",title:"Process Digital Conformity Credential",description:"Description",source:"@site/docs/mock-apps/services/process-digital-conformity-credential.md",sourceDirName:"mock-apps/services",slug:"/mock-apps/services/process-digital-conformity-credential",permalink:"/tests-untp/docs/mock-apps/services/process-digital-conformity-credential",draft:!1,unlisted:!1,editUrl:"https://github.com/uncefact/tests-untp/tree/main/docs/mock-apps/services/process-digital-conformity-credential.md",tags:[],version:"current",sidebarPosition:53,frontMatter:{sidebar_position:53,title:"Process Digital Conformity Credential"},sidebar:"tutorialSidebar",previous:{title:"Process Aggregation Event",permalink:"/tests-untp/docs/mock-apps/services/process-aggregation-event"},next:{title:"Common",permalink:"/tests-untp/docs/mock-apps/common/"}},c={},l=[...s.RM,{value:"Description",id:"description",level:2},{value:"Diagram",id:"diagram",level:2},{value:"Example",id:"example",level:2},{value:"Definitions",id:"definitions",level:2}];function p(e){const t={a:"a",code:"code",h2:"h2",mermaid:"mermaid",p:"p",pre:"pre",table:"table",tbody:"tbody",td:"td",th:"th",thead:"thead",tr:"tr",...(0,r.R)(),...e.components};return(0,n.jsxs)(n.Fragment,{children:[(0,n.jsx)(s.Ay,{}),"\n",(0,n.jsx)(t.h2,{id:"description",children:"Description"}),"\n",(0,n.jsxs)(t.p,{children:["The ",(0,n.jsx)(t.code,{children:"processDigitalConformityCredential"})," service is responsible for processing a digital conformity credential, issuing a ",(0,n.jsx)(t.a,{href:"https://uncefact.github.io/spec-untp/docs/specification/VerifiableCredentials",children:"Verifiable Credential (VC)"}),", uploading it to the ",(0,n.jsx)(t.a,{href:"/docs/mock-apps/dependent-services/storage-service",children:"Storage service"}),", registering the link to the stored digital conformity credential with the ",(0,n.jsx)(t.a,{href:"/docs/mock-apps/dependent-services/identity-resolution-service",children:"Identity Resolver service"}),". It handles the entire lifecycle of creating and managing a digital conformity credential, from data input to storage and resolution."]}),"\n",(0,n.jsx)(t.h2,{id:"diagram",children:"Diagram"}),"\n",(0,n.jsx)(t.mermaid,{value:"sequenceDiagram\nparticipant C as Client\nparticipant P as processDigitalConformityCredential\nparticipant V as VCKit\nparticipant S as Storage\nparticipant D as DLR\nC->>P: Call processDigitalConformityCredential(digitalConformityCredential, context)\nP->>P: Validate context\nP->>P: Extract identifier\nP->>V: Issue VC\nV--\x3e>P: Return VC\nP->>S: Upload VC\nS--\x3e>P: Return VC URL\nP->>D: Register link resolver\nD--\x3e>P: Return resolver URL\nP--\x3e>C: Return digital conformity credential VC and resolver URL"}),"\n",(0,n.jsx)(t.h2,{id:"example",children:"Example"}),"\n",(0,n.jsx)(t.pre,{children:(0,n.jsx)(t.code,{className:"language-json",children:'{\n  "name": "processDigitalConformityCredential",\n  "parameters": [\n    {\n      "vckit": {\n        "vckitAPIUrl": "https://api.vckit.example.com",\n        "issuer": "did:example:123456789abcdefghi"\n      },\n      "digitalConformityCredential": {\n        "context": [\n          "https://jargon.sh/user/unece/ConformityCredential/v/0.5.0/artefacts/jsonldContexts/ConformityCredential.jsonld?class=ConformityCredential"\n        ],\n        "type": ["DigitalConformityCredential"],\n        "renderTemplate": [\n          {\n            "template": "<div><h2>DigitalConformityCredential</h2></div>",\n            "@type": "WebRenderingTemplate2022"\n          }\n        ],\n        "dlrIdentificationKeyType": "gtin",\n        "dlrLinkTitle": "DigitalConformityCredential",\n        "dlrVerificationPage": "https://verify.example.com"\n      },\n      "storage": {\n        "url": "https://storage.example.com/upload",\n        "params": {\n          "bucket": "bucket-name",\n          "resultPath": "/url"\n        }\n      },\n      "dlr": {\n        "dlrAPIUrl": "https://dlr.example.com/api",\n        "dlrAPIKey": "dlr-api-key-12345",\n        "namespace": "gs1",\n        "linkRegisterPath": "/api/resolver"\n      },\n      "identifierKeyPath": "/id"\n    }\n  ]\n}\n'})}),"\n",(0,n.jsx)(t.h2,{id:"definitions",children:"Definitions"}),"\n",(0,n.jsxs)(t.table,{children:[(0,n.jsx)(t.thead,{children:(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.th,{children:"Property"}),(0,n.jsx)(t.th,{children:"Required"}),(0,n.jsx)(t.th,{children:"Description"}),(0,n.jsx)(t.th,{children:"Type"})]})}),(0,n.jsxs)(t.tbody,{children:[(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.td,{children:"vckit"}),(0,n.jsx)(t.td,{children:"Yes"}),(0,n.jsx)(t.td,{children:"Configuration for the VCKit service"}),(0,n.jsx)(t.td,{children:(0,n.jsx)(t.a,{href:"/docs/mock-apps/common/vckit",children:"VCKit"})})]}),(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.td,{children:"digitalConformityCredential"}),(0,n.jsx)(t.td,{children:"Yes"}),(0,n.jsx)(t.td,{children:"Configuration for the Digital Conformity Credential"}),(0,n.jsx)(t.td,{children:(0,n.jsx)(t.a,{href:"/docs/mock-apps/common/credential",children:"Credential"})})]}),(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.td,{children:"storage"}),(0,n.jsx)(t.td,{children:"Yes"}),(0,n.jsx)(t.td,{children:"Configuration for storage service"}),(0,n.jsx)(t.td,{children:(0,n.jsx)(t.a,{href:"/docs/mock-apps/common/storage",children:"Storage"})})]}),(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.td,{children:"dlr"}),(0,n.jsx)(t.td,{children:"Yes"}),(0,n.jsx)(t.td,{children:"Configuration for the Digital Link Resolver"}),(0,n.jsx)(t.td,{children:(0,n.jsx)(t.a,{href:"/docs/mock-apps/common/idr",children:"IDR"})})]}),(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.td,{children:"identifierKeyPath"}),(0,n.jsx)(t.td,{children:"Yes"}),(0,n.jsx)(t.td,{children:"JSON path to the identifier in the credential subject or the object for function and arguments of JSON path to construct identifier"}),(0,n.jsx)(t.td,{children:(0,n.jsx)(t.a,{href:"/docs/mock-apps/common/identifier-key-path",children:"IdentifierKeyPath"})})]})]})]})]})}function m(e={}){const{wrapper:t}={...(0,r.R)(),...e.components};return t?(0,n.jsx)(t,{...e,children:(0,n.jsx)(p,{...e})}):p(e)}},8453:(e,t,i)=>{i.d(t,{R:()=>o,x:()=>a});var n=i(6540);const r={},s=n.createContext(r);function o(e){const t=n.useContext(s);return n.useMemo((function(){return"function"==typeof e?e(t):{...t,...e}}),[t,e])}function a(e){let t;return t=e.disableParentContext?"function"==typeof e.components?e.components(r):e.components||r:o(e.components),n.createElement(s.Provider,{value:t},e.children)}}}]);