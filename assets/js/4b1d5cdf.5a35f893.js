"use strict";(self.webpackChunkdocumentation=self.webpackChunkdocumentation||[]).push([[7704],{8481:(e,t,n)=>{n.d(t,{Ay:()=>c,RM:()=>r});var i=n(4848),s=n(8453);const r=[];function o(e){const t={admonition:"admonition",p:"p",...(0,s.R)(),...e.components};return(0,i.jsx)(t.admonition,{type:"info",children:(0,i.jsx)(t.p,{children:"Please note that this content is under development and is not ready for implementation. This status message will be updated as content development progresses."})})}function c(e={}){const{wrapper:t}={...(0,s.R)(),...e.components};return t?(0,i.jsx)(t,{...e,children:(0,i.jsx)(o,{...e})}):o(e)}},2338:(e,t,n)=>{n.r(t),n.d(t,{assets:()=>d,contentTitle:()=>c,default:()=>h,frontMatter:()=>o,metadata:()=>a,toc:()=>l});var i=n(4848),s=n(8453),r=n(8481);const o={sidebar_position:44,title:"Process Association Event"},c=void 0,a={id:"mock-apps/services/process-association-event",title:"Process Association Event",description:"Description",source:"@site/docs/mock-apps/services/process-association-event.md",sourceDirName:"mock-apps/services",slug:"/mock-apps/services/process-association-event",permalink:"/tests-untp/docs/mock-apps/services/process-association-event",draft:!1,unlisted:!1,editUrl:"https://github.com/uncefact/tests-untp/tree/main/docs/mock-apps/services/process-association-event.md",tags:[],version:"current",sidebarPosition:44,frontMatter:{sidebar_position:44,title:"Process Association Event"},sidebar:"tutorialSidebar",previous:{title:"Process Digital Identity Anchor",permalink:"/tests-untp/docs/mock-apps/services/process-digital-identity-anchor"},next:{title:"Process Aggregation Event",permalink:"/tests-untp/docs/mock-apps/services/process-aggregation-event"}},d={},l=[...r.RM,{value:"Description",id:"description",level:2},{value:"Diagram",id:"diagram",level:2},{value:"Example",id:"example",level:2},{value:"Definitions",id:"definitions",level:2}];function p(e){const t={a:"a",code:"code",h2:"h2",mermaid:"mermaid",p:"p",pre:"pre",table:"table",tbody:"tbody",td:"td",th:"th",thead:"thead",tr:"tr",...(0,s.R)(),...e.components};return(0,i.jsxs)(i.Fragment,{children:[(0,i.jsx)(r.Ay,{}),"\n",(0,i.jsx)(t.h2,{id:"description",children:"Description"}),"\n",(0,i.jsxs)(t.p,{children:["The ",(0,i.jsx)(t.code,{children:"processAssociationEvent"})," service is responsible for processing an ",(0,i.jsx)(t.a,{href:"https://uncefact.github.io/spec-untp/docs/specification/DigitalTraceabilityEvents",children:"Association Event (DTE)"}),", issuing a ",(0,i.jsx)(t.a,{href:"https://uncefact.github.io/spec-untp/docs/specification/VerifiableCredentials",children:"Verifiable Credential (VC)"}),", uploading it to the ",(0,i.jsx)(t.a,{href:"/docs/mock-apps/dependent-services/storage-service",children:"Storage service"}),", registering the link to the stored DTE with the ",(0,i.jsx)(t.a,{href:"/docs/mock-apps/dependent-services/identity-resolution-service",children:"Identity Resolver service"}),". It handles the entire lifecycle of creating and managing an association event, from data input to storage and resolution."]}),"\n",(0,i.jsx)(t.h2,{id:"diagram",children:"Diagram"}),"\n",(0,i.jsx)(t.mermaid,{value:"sequenceDiagram\nparticipant C as Client\nparticipant P as processAssociationEvent\nparticipant V as VCKit\nparticipant S as Storage\nparticipant D as DLR\nC->>P: Call processAssociationEvent(associationEvent, context)\nP->>P: Validate context\nP->>P: Extract identifier\nP->>V: Issue VC\nV--\x3e>P: Return VC\nP->>S: Upload VC\nS--\x3e>P: Return VC URL\nP->>D: Register link resolver\nD--\x3e>P: Return resolver URL\nP--\x3e>C: Return association event VC and resolver URL"}),"\n",(0,i.jsx)(t.h2,{id:"example",children:"Example"}),"\n",(0,i.jsx)(t.pre,{children:(0,i.jsx)(t.code,{className:"language-json",children:'{\n  "name": "processAssociationEvent",\n  "parameters": [\n    {\n      "vckit": {\n        "vckitAPIUrl": "https://api.vckit.example.com",\n        "issuer": "did:example:123456789abcdefghi"\n      },\n      "epcisAssociationEvent": {\n        "context": [\n          "https://jargon.sh/user/unece/traceabilityEvents/v/0.5.0/artefacts/jsonldContexts/traceabilityEvents.jsonld?class=traceabilityEvents"\n        ],\n        "type": ["VerifiableCredential", "DigitalTraceabilityEvent"],\n        "renderTemplate": [\n          {\n            "template": "<div><h2>Association Event</h2></div>",\n            "@type": "WebRenderingTemplate2022"\n          }\n        ],\n        "dlrIdentificationKeyType": "gtin",\n        "dlrLinkTitle": "Association Event",\n        "dlrVerificationPage": "https://verify.example.com"\n      },\n      "storage": {\n        "url": "https://storage.example.com/upload",\n        "params": {\n          "bucket": "bucket-name",\n          "resultPath": "/url"\n        }\n      },\n      "dlr": {\n        "dlrAPIUrl": "https://dlr.example.com/api",\n        "dlrAPIKey": "dlr-api-key-12345",\n        "namespace": "gs1",\n        "linkRegisterPath": "/api/resolver"\n      },\n      "identifierKeyPath": "/id"\n    }\n  ]\n}\n'})}),"\n",(0,i.jsx)(t.h2,{id:"definitions",children:"Definitions"}),"\n",(0,i.jsxs)(t.table,{children:[(0,i.jsx)(t.thead,{children:(0,i.jsxs)(t.tr,{children:[(0,i.jsx)(t.th,{children:"Property"}),(0,i.jsx)(t.th,{children:"Required"}),(0,i.jsx)(t.th,{children:"Description"}),(0,i.jsx)(t.th,{children:"Type"})]})}),(0,i.jsxs)(t.tbody,{children:[(0,i.jsxs)(t.tr,{children:[(0,i.jsx)(t.td,{children:"vckit"}),(0,i.jsx)(t.td,{children:"Yes"}),(0,i.jsx)(t.td,{children:"Configuration for the VCKit service"}),(0,i.jsx)(t.td,{children:(0,i.jsx)(t.a,{href:"/docs/mock-apps/common/vckit",children:"VCKit"})})]}),(0,i.jsxs)(t.tr,{children:[(0,i.jsx)(t.td,{children:"epcisAssociationEvent"}),(0,i.jsx)(t.td,{children:"Yes"}),(0,i.jsx)(t.td,{children:"Configuration for the EPCIS Association Event Event"}),(0,i.jsx)(t.td,{children:(0,i.jsx)(t.a,{href:"/docs/mock-apps/common/credential",children:"Credential"})})]}),(0,i.jsxs)(t.tr,{children:[(0,i.jsx)(t.td,{children:"storage"}),(0,i.jsx)(t.td,{children:"Yes"}),(0,i.jsx)(t.td,{children:"Configuration for storage service"}),(0,i.jsx)(t.td,{children:(0,i.jsx)(t.a,{href:"/docs/mock-apps/common/storage",children:"Storage"})})]}),(0,i.jsxs)(t.tr,{children:[(0,i.jsx)(t.td,{children:"dlr"}),(0,i.jsx)(t.td,{children:"Yes"}),(0,i.jsx)(t.td,{children:"Configuration for the Digital Link Resolver"}),(0,i.jsx)(t.td,{children:(0,i.jsx)(t.a,{href:"/docs/mock-apps/common/idr",children:"IDR"})})]}),(0,i.jsxs)(t.tr,{children:[(0,i.jsx)(t.td,{children:"identifierKeyPath"}),(0,i.jsx)(t.td,{children:"Yes"}),(0,i.jsx)(t.td,{children:"JSON path to the identifier in the credential subject or the association for function and arguments of JSON path to construct identifier"}),(0,i.jsx)(t.td,{children:(0,i.jsx)(t.a,{href:"/docs/mock-apps/common/identifier-key-path",children:"IdentifierKeyPath"})})]})]})]})]})}function h(e={}){const{wrapper:t}={...(0,s.R)(),...e.components};return t?(0,i.jsx)(t,{...e,children:(0,i.jsx)(p,{...e})}):p(e)}},8453:(e,t,n)=>{n.d(t,{R:()=>o,x:()=>c});var i=n(6540);const s={},r=i.createContext(s);function o(e){const t=i.useContext(r);return i.useMemo((function(){return"function"==typeof e?e(t):{...t,...e}}),[t,e])}function c(e){let t;return t=e.disableParentContext?"function"==typeof e.components?e.components(s):e.components||s:o(e.components),i.createElement(r.Provider,{value:t},e.children)}}}]);