"use strict";(self.webpackChunkdocumentation=self.webpackChunkdocumentation||[]).push([[2097],{8481:(e,t,n)=>{n.d(t,{Ay:()=>c,RM:()=>r});var s=n(4848),i=n(8453);const r=[];function o(e){const t={admonition:"admonition",p:"p",...(0,i.R)(),...e.components};return(0,s.jsx)(t.admonition,{type:"info",children:(0,s.jsx)(t.p,{children:"Please note that this content is under development and is not ready for implementation. This status message will be updated as content development progresses."})})}function c(e={}){const{wrapper:t}={...(0,i.R)(),...e.components};return t?(0,s.jsx)(t,{...e,children:(0,s.jsx)(o,{...e})}):o(e)}},2021:(e,t,n)=>{n.r(t),n.d(t,{assets:()=>l,contentTitle:()=>c,default:()=>h,frontMatter:()=>o,metadata:()=>a,toc:()=>d});var s=n(4848),i=n(8453),r=n(8481);const o={sidebar_position:9,title:"Testing Storage"},c=void 0,a={id:"test-suites/technical-interoperability/storage/testing",title:"Testing Storage",description:"The Storage component is a critical part of the UNTP ecosystem, responsible for securely storing and retrieving credentials and related data. This test suite verifies the functionality, security, and accessibility of your storage implementation.",source:"@site/docs/test-suites/technical-interoperability/storage/testing.md",sourceDirName:"test-suites/technical-interoperability/storage",slug:"/test-suites/technical-interoperability/storage/testing",permalink:"/tests-untp/docs/test-suites/technical-interoperability/storage/testing",draft:!1,unlisted:!1,editUrl:"https://github.com/uncefact/tests-untp/tree/main/docs/test-suites/technical-interoperability/storage/testing.md",tags:[],version:"current",sidebarPosition:9,frontMatter:{sidebar_position:9,title:"Testing Storage"},sidebar:"tutorialSidebar",previous:{title:"Storage",permalink:"/tests-untp/docs/test-suites/technical-interoperability/storage/"},next:{title:"Identity Resolution (IDR)",permalink:"/tests-untp/docs/test-suites/technical-interoperability/identity-resolution/"}},l={},d=[...r.RM,{value:"Testing Instructions",id:"testing-instructions",level:2}];function u(e){const t={a:"a",code:"code",h2:"h2",li:"li",ol:"ol",p:"p",pre:"pre",strong:"strong",ul:"ul",...(0,i.R)(),...e.components};return(0,s.jsxs)(s.Fragment,{children:[(0,s.jsx)(r.Ay,{}),"\n",(0,s.jsxs)(t.p,{children:["The Storage component is a critical part of the UNTP ecosystem, responsible for ",(0,s.jsx)(t.a,{href:"https://uncefact.github.io/spec-untp/docs/specification/DecentralisedAccessControl",children:"securely storing and retrieving credentials and related data"}),". This test suite verifies the functionality, security, and accessibility of your storage implementation."]}),"\n",(0,s.jsx)(t.h2,{id:"testing-instructions",children:"Testing Instructions"}),"\n",(0,s.jsx)(t.p,{children:"To test your Storage implementation, follow these steps:"}),"\n",(0,s.jsxs)(t.ol,{children:["\n",(0,s.jsxs)(t.li,{children:["\n",(0,s.jsxs)(t.p,{children:[(0,s.jsx)(t.strong,{children:"Update the Configuration"}),":"]}),"\n",(0,s.jsxs)(t.ul,{children:["\n",(0,s.jsxs)(t.li,{children:["\n",(0,s.jsxs)(t.p,{children:["Navigate to the config file: ",(0,s.jsx)(t.code,{children:"packages/vc-test-suite/config.ts"})]}),"\n"]}),"\n",(0,s.jsxs)(t.li,{children:["\n",(0,s.jsxs)(t.p,{children:["Update the ",(0,s.jsx)(t.code,{children:"Storage"})," section with your implementation details. The file should look similar to this:"]}),"\n",(0,s.jsx)(t.pre,{children:(0,s.jsx)(t.code,{className:"language-typescript",children:"export default {\n  implementationName: 'UNTP ACME',\n  testSuites: {\n    Storage: {\n      url: 'http://localhost:3334/v1/documents',\n      encryptionUrl: 'http://localhost:3334/v1/credentials',\n      headers: {},\n      additionalParams: {},\n      additionalPayload: { bucket: 'verifiable-credentials' },\n    },\n  },\n};\n"})}),"\n"]}),"\n"]}),"\n",(0,s.jsxs)(t.p,{children:["Adjust the ",(0,s.jsx)(t.code,{children:"url"}),", ",(0,s.jsx)(t.code,{children:"encryptionUrl"}),", ",(0,s.jsx)(t.code,{children:"headers"}),", ",(0,s.jsx)(t.code,{children:"additionalParams"}),", and ",(0,s.jsx)(t.code,{children:"additionalPayload"})," as necessary for your implementation."]}),"\n"]}),"\n",(0,s.jsxs)(t.li,{children:["\n",(0,s.jsxs)(t.p,{children:[(0,s.jsx)(t.strong,{children:"Run the Test"}),":"]}),"\n",(0,s.jsxs)(t.ul,{children:["\n",(0,s.jsxs)(t.li,{children:["Navigate to ",(0,s.jsx)(t.code,{children:"packages/vc-test-suite"})]}),"\n",(0,s.jsxs)(t.li,{children:["In your terminal, run the command: ",(0,s.jsx)(t.code,{children:"yarn test"})]}),"\n"]}),"\n"]}),"\n",(0,s.jsxs)(t.li,{children:["\n",(0,s.jsxs)(t.p,{children:[(0,s.jsx)(t.strong,{children:"View Test Results"}),":"]}),"\n",(0,s.jsxs)(t.ul,{children:["\n",(0,s.jsxs)(t.li,{children:["Navigate to ",(0,s.jsx)(t.code,{children:"packages/vc-test-suite/reports/index.html"})]}),"\n",(0,s.jsx)(t.li,{children:"Open this file in a web browser"}),"\n",(0,s.jsx)(t.li,{children:'Look for the "Storage Service" section to view your test results'}),"\n"]}),"\n"]}),"\n"]})]})}function h(e={}){const{wrapper:t}={...(0,i.R)(),...e.components};return t?(0,s.jsx)(t,{...e,children:(0,s.jsx)(u,{...e})}):u(e)}},8453:(e,t,n)=>{n.d(t,{R:()=>o,x:()=>c});var s=n(6540);const i={},r=s.createContext(i);function o(e){const t=s.useContext(r);return s.useMemo((function(){return"function"==typeof e?e(t):{...t,...e}}),[t,e])}function c(e){let t;return t=e.disableParentContext?"function"==typeof e.components?e.components(i):e.components||i:o(e.components),s.createElement(r.Provider,{value:t},e.children)}}}]);