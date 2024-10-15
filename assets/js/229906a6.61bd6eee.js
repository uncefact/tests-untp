"use strict";(self.webpackChunkdocumentation=self.webpackChunkdocumentation||[]).push([[1614],{8481:(e,n,t)=>{t.d(n,{Ay:()=>o,RM:()=>i});var s=t(4848),r=t(8453);const i=[];function a(e){const n={admonition:"admonition",p:"p",...(0,r.R)(),...e.components};return(0,s.jsx)(n.admonition,{type:"info",children:(0,s.jsx)(n.p,{children:"Please note that this content is under development and is not ready for implementation. This status message will be updated as content development progresses."})})}function o(e={}){const{wrapper:n}={...(0,r.R)(),...e.components};return n?(0,s.jsx)(n,{...e,children:(0,s.jsx)(a,{...e})}):a(e)}},5824:(e,n,t)=>{t.r(n),t.d(n,{assets:()=>d,contentTitle:()=>o,default:()=>h,frontMatter:()=>a,metadata:()=>c,toc:()=>l});var s=t(4848),r=t(8453),i=t(8481);const a={sidebar_position:22,title:"Services"},o=void 0,c={id:"mock-apps/services/index",title:"Services",description:"Services are units of business logic that perform specific operations or interactions with external systems. They handle data processing, API calls, and other backend functionalities.",source:"@site/docs/mock-apps/services/index.md",sourceDirName:"mock-apps/services",slug:"/mock-apps/services/",permalink:"/tests-untp/docs/mock-apps/services/",draft:!1,unlisted:!1,editUrl:"https://github.com/uncefact/tests-untp/tree/main/docs/mock-apps/services/index.md",tags:[],version:"current",sidebarPosition:22,frontMatter:{sidebar_position:22,title:"Services"},sidebar:"tutorialSidebar",previous:{title:"QR Code Scanner Dialog Button",permalink:"/tests-untp/docs/mock-apps/components/qr-code-scanner-dialog-button"},next:{title:"Process DPP",permalink:"/tests-untp/docs/mock-apps/services/process-dpp"}},d={},l=[...i.RM,{value:"Available Services",id:"available-services",level:2},{value:"Diagram",id:"diagram",level:2},{value:"Config",id:"config",level:2},{value:"Example",id:"example",level:2}];function p(e){const n={a:"a",code:"code",h2:"h2",li:"li",mermaid:"mermaid",p:"p",pre:"pre",table:"table",tbody:"tbody",td:"td",th:"th",thead:"thead",tr:"tr",ul:"ul",...(0,r.R)(),...e.components};return(0,s.jsxs)(s.Fragment,{children:[(0,s.jsx)(i.Ay,{}),"\n",(0,s.jsx)(n.p,{children:"Services are units of business logic that perform specific operations or interactions with external systems. They handle data processing, API calls, and other backend functionalities."}),"\n",(0,s.jsx)(n.h2,{id:"available-services",children:"Available Services"}),"\n",(0,s.jsxs)(n.ul,{children:["\n",(0,s.jsx)(n.li,{children:(0,s.jsx)(n.a,{href:"./process-dpp",children:"Process DPP"})}),"\n",(0,s.jsx)(n.li,{children:(0,s.jsx)(n.a,{href:"./process-digital-identity-anchor",children:"Process Digital Identity Anchor"})}),"\n",(0,s.jsx)(n.li,{children:(0,s.jsx)(n.a,{href:"./process-transaction-event",children:"Process Transaction Event"})}),"\n",(0,s.jsx)(n.li,{children:(0,s.jsx)(n.a,{href:"./process-transformation-event",children:"Process Transformation Event"})}),"\n",(0,s.jsx)(n.li,{children:(0,s.jsx)(n.a,{href:"./process-aggregation-event",children:"Process Aggregation Event"})}),"\n",(0,s.jsx)(n.li,{children:(0,s.jsx)(n.a,{href:"./merge-to-local-storage",children:"Merge To Local Storage"})}),"\n"]}),"\n",(0,s.jsx)(n.h2,{id:"diagram",children:"Diagram"}),"\n",(0,s.jsx)(n.mermaid,{value:"graph TD\n    A[Service]\n    A --\x3e B[Name]\n    A --\x3e C[Parameters]\n\n    C --\x3e C1[Parameter 1]\n    C --\x3e C2[Parameter 2]\n\n    C1 --\x3e D1[vckit]\n    C1 --\x3e D2[dpp]\n    C1 --\x3e D3[dlr]\n    C1 --\x3e D4[storage]\n    C1 --\x3e D5[identifierKeyPath]"}),"\n",(0,s.jsx)(n.h2,{id:"config",children:"Config"}),"\n",(0,s.jsxs)(n.table,{children:[(0,s.jsx)(n.thead,{children:(0,s.jsxs)(n.tr,{children:[(0,s.jsx)(n.th,{children:"Property"}),(0,s.jsx)(n.th,{children:"Required"}),(0,s.jsx)(n.th,{children:"Description"}),(0,s.jsx)(n.th,{children:"Type"})]})}),(0,s.jsxs)(n.tbody,{children:[(0,s.jsxs)(n.tr,{children:[(0,s.jsx)(n.td,{children:"name"}),(0,s.jsx)(n.td,{children:"Yes"}),(0,s.jsx)(n.td,{children:"The name of the service (depends on service used)"}),(0,s.jsx)(n.td,{children:(0,s.jsx)(n.a,{href:"#available-services",children:"Service"})})]}),(0,s.jsxs)(n.tr,{children:[(0,s.jsx)(n.td,{children:"parameters"}),(0,s.jsx)(n.td,{children:"Yes"}),(0,s.jsx)(n.td,{children:"An array of parameter objects for the services (depends on service used)"}),(0,s.jsx)(n.td,{children:(0,s.jsx)(n.a,{href:"#available-services",children:"Service"})})]})]})]}),"\n",(0,s.jsx)(n.h2,{id:"example",children:"Example"}),"\n",(0,s.jsx)(n.pre,{children:(0,s.jsx)(n.code,{className:"language-json",children:'{\n  "services": [\n    {\n      "name": "processDPP",\n      "parameters": [\n        {\n          "vckit": {\n            "vckitAPIUrl": "http://localhost:3332/v2",\n            "issuer": "did:web:example.com"\n          },\n          "dpp": {\n            "context": ["https://dpp-json-ld.s3.ap-southeast-2.amazonaws.com/dppld.json"],\n            "renderTemplate": [],\n            "type": ["VerifiableCredential", " DigitalProductPassport"],\n            "dlrLinkTitle": "Steel Passport",\n            "dlrIdentificationKeyType": "gtin",\n            "dlrVerificationPage": "http://localhost:3000/verify"\n          },\n          "dlr": {\n            "dlrAPIUrl": "http://localhost:8080",\n            "dlrAPIKey": "5555555555555"\n          },\n          "storage": {\n            "url": "http://localhost:3001/upload",\n            "params": {\n              "resultPath": "/url"\n            },\n            "options": {\n              "method": "POST",\n              "headers": {\n                "Content-Type": "application/json"\n              }\n            }\n          },\n          "identifierKeyPath": "/product/itemIdentifiers/0/identifierValue"\n        }\n      ]\n    },\n    {\n      "name": "mergeToLocalStorage",\n      "parameters": [\n        {\n          "storageKey": "Steel_Mill_1_dpps",\n          "objectKeyPath": "/vc/credentialSubject/product/itemIdentifiers/0/identifierValue"\n        }\n      ]\n    }\n  ]\n}\n'})}),"\n",(0,s.jsx)(n.p,{children:"For detailed information about each service, please refer to their respective documentation pages linked above."})]})}function h(e={}){const{wrapper:n}={...(0,r.R)(),...e.components};return n?(0,s.jsx)(n,{...e,children:(0,s.jsx)(p,{...e})}):p(e)}},8453:(e,n,t)=>{t.d(n,{R:()=>a,x:()=>o});var s=t(6540);const r={},i=s.createContext(r);function a(e){const n=s.useContext(i);return s.useMemo((function(){return"function"==typeof e?e(n):{...n,...e}}),[n,e])}function o(e){let n;return n=e.disableParentContext?"function"==typeof e.components?e.components(r):e.components||r:a(e.components),s.createElement(i.Provider,{value:n},e.children)}}}]);