"use strict";(self.webpackChunkdocumentation=self.webpackChunkdocumentation||[]).push([[2191],{8481:(e,n,t)=>{t.d(n,{Ay:()=>c,RM:()=>r});var i=t(4848),s=t(8453);const r=[];function o(e){const n={admonition:"admonition",p:"p",...(0,s.R)(),...e.components};return(0,i.jsx)(n.admonition,{type:"info",children:(0,i.jsx)(n.p,{children:"Please note that this content is under development and is not ready for implementation. This status message will be updated as content development progresses."})})}function c(e={}){const{wrapper:n}={...(0,s.R)(),...e.components};return n?(0,i.jsx)(n,{...e,children:(0,i.jsx)(o,{...e})}):o(e)}},814:(e,n,t)=>{t.r(n),t.d(n,{assets:()=>d,contentTitle:()=>c,default:()=>p,frontMatter:()=>o,metadata:()=>a,toc:()=>l});var i=t(4848),s=t(8453),r=t(8481);const o={sidebar_position:6,title:"QR Link / Encryption"},c=void 0,a={id:"test-suites/technical-interoperability/untp-extensions/qr-link-encryption",title:"QR Link / Encryption",description:"The QR Link / Encryption feature is a crucial component of the UNTP ecosystem, providing a standardised way to access, verify, and render credentials.",source:"@site/docs/test-suites/technical-interoperability/untp-extensions/qr-link-encryption.md",sourceDirName:"test-suites/technical-interoperability/untp-extensions",slug:"/test-suites/technical-interoperability/untp-extensions/qr-link-encryption",permalink:"/tests-untp/docs/test-suites/technical-interoperability/untp-extensions/qr-link-encryption",draft:!1,unlisted:!1,editUrl:"https://github.com/uncefact/tests-untp/tree/main/docs/test-suites/technical-interoperability/untp-extensions/qr-link-encryption.md",tags:[],version:"current",sidebarPosition:6,frontMatter:{sidebar_position:6,title:"QR Link / Encryption"},sidebar:"tutorialSidebar",previous:{title:"UNTP Extensions",permalink:"/tests-untp/docs/test-suites/technical-interoperability/untp-extensions/"},next:{title:"Rendering",permalink:"/tests-untp/docs/test-suites/technical-interoperability/untp-extensions/rendering"}},d={},l=[...r.RM,{value:"Testing Instructions",id:"testing-instructions",level:2},{value:"Payload Structure",id:"payload-structure",level:2}];function h(e){const n={a:"a",code:"code",h2:"h2",li:"li",ol:"ol",p:"p",pre:"pre",strong:"strong",ul:"ul",...(0,s.R)(),...e.components};return(0,i.jsxs)(i.Fragment,{children:[(0,i.jsx)(r.Ay,{}),"\n",(0,i.jsx)(n.p,{children:"The QR Link / Encryption feature is a crucial component of the UNTP ecosystem, providing a standardised way to access, verify, and render credentials."}),"\n",(0,i.jsxs)(n.p,{children:["For detailed information about the Verify Link structure and usage, please refer to the ",(0,i.jsx)(n.a,{href:"/docs/mock-apps/common/verify-link",children:"Verify Link documentation"}),"."]}),"\n",(0,i.jsx)(n.h2,{id:"testing-instructions",children:"Testing Instructions"}),"\n",(0,i.jsx)(n.p,{children:"To test your QR Link / Encryption implementation, follow these steps:"}),"\n",(0,i.jsxs)(n.ol,{children:["\n",(0,i.jsxs)(n.li,{children:["\n",(0,i.jsxs)(n.p,{children:[(0,i.jsx)(n.strong,{children:"Obtain a Verify Link"}),": Obtain a verify link produced by your implementation that you would like to test."]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:["\n",(0,i.jsxs)(n.p,{children:[(0,i.jsx)(n.strong,{children:"Update the Configuration"}),":"]}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsxs)(n.li,{children:["\n",(0,i.jsxs)(n.p,{children:["Navigate to the config file: ",(0,i.jsx)(n.code,{children:"packages/vc-test-suite/config.ts"})]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:["\n",(0,i.jsxs)(n.p,{children:["Update the ",(0,i.jsx)(n.code,{children:"QrLinkEncrypted"})," section with your verify link (see ",(0,i.jsx)(n.a,{href:"/docs/test-suites/technical-interoperability/untp-extensions/qr-link-encryption#payload-structure",children:"payload structure"}),"). The file should look similar to this:"]}),"\n",(0,i.jsx)(n.pre,{children:(0,i.jsx)(n.code,{className:"language-typescript",children:"export default {\n  implementationName: 'UNTP ACME',\n  testSuites: {\n    QrLinkEncrypted: {\n      url: 'https://example.com/credential-verifier?q=%7B%22payload%22%3A%7B%22uri%22%3A%22https%3A%2F%2Fapi.vckit.showthething.com%2Fencrypted-storage%2Fencrypted-data%2F0a6031a9-2740-49cd-b12b-1ed02820f01d%22%2C%22key%22%3A%22d0ad322ec820a0a420262a6b7dbdafb16eb1d35af459182022bc531d18643546%22%2C%20%22hash%22%3A%20%22QmX8fk9hygXQDbt4KsGEMiUXbt7HDRnb772HNcKtZcL2Zr%22%7D%7D',\n      headers: {},\n      method: 'GET',\n    },\n  },\n};\n"})}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.p,{children:["Replace the ",(0,i.jsx)(n.code,{children:"url"})," value with your verify link."]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:["\n",(0,i.jsxs)(n.p,{children:[(0,i.jsx)(n.strong,{children:"Run the Test"}),":"]}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsxs)(n.li,{children:["Navigate to ",(0,i.jsx)(n.code,{children:"packages/vc-test-suite"})]}),"\n",(0,i.jsxs)(n.li,{children:["In your terminal, run the command: ",(0,i.jsx)(n.code,{children:"yarn test"})]}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:["\n",(0,i.jsxs)(n.p,{children:[(0,i.jsx)(n.strong,{children:"View Test Results"}),":"]}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsxs)(n.li,{children:["Navigate to ",(0,i.jsx)(n.code,{children:"packages/vc-test-suite/reports/index.html"})]}),"\n",(0,i.jsx)(n.li,{children:"Open this file in a web browser"}),"\n",(0,i.jsx)(n.li,{children:'Look for the "QR Link Verification" section to view your test results'}),"\n"]}),"\n"]}),"\n"]}),"\n",(0,i.jsx)(n.p,{children:"These tests will validate that your QR Link / Encryption implementation adheres to the UNTP protocol."}),"\n",(0,i.jsx)(n.h2,{id:"payload-structure",children:"Payload Structure"}),"\n",(0,i.jsx)(n.p,{children:"The QR Link payload is a crucial part of the verification process. Let's break down the structure of the payload:"}),"\n",(0,i.jsx)(n.pre,{children:(0,i.jsx)(n.code,{className:"language-javascript",children:"QrLinkEncrypted: {\n  url: 'https://example.com/credential-verifier?q=%7B%22payload%22%3A%7B%22uri%22%3A%22https%3A%2F%2Fapi.vckit.showthething.com%2Fencrypted-storage%2Fencrypted-data%2F0a6031a9-2740-49cd-b12b-1ed02820f01d%22%2C%22key%22%3A%22d0ad322ec820a0a420262a6b7dbdafb16eb1d35af459182022bc531d18643546%22%2C%20%22hash%22%3A%20%22QmX8fk9hygXQDbt4KsGEMiUXbt7HDRnb772HNcKtZcL2Zr%22%7D%7D',\n  headers: {},\n  method: 'GET',\n},\n"})}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsxs)(n.li,{children:["\n",(0,i.jsxs)(n.p,{children:[(0,i.jsx)(n.code,{children:"url"}),": This is the full URL for the credential verifier, including the encoded payload."]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:["\n",(0,i.jsxs)(n.p,{children:[(0,i.jsx)(n.code,{children:"headers"}),": An object containing any additional HTTP headers required for the request to the storage service. In this example, it's empty, but you may need to add headers depending on your implementation."]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:["\n",(0,i.jsxs)(n.p,{children:[(0,i.jsx)(n.code,{children:"method"}),": The HTTP method used to request the verifiable credential from the storage service. In this case, it's set to 'GET'."]}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.p,{children:["The ",(0,i.jsx)(n.code,{children:"uri"})," within the payload points to the storage service that will return the verifiable credential. The ",(0,i.jsx)(n.code,{children:"headers"})," and ",(0,i.jsx)(n.code,{children:"method"})," are used in the request to this storage service."]})]})}function p(e={}){const{wrapper:n}={...(0,s.R)(),...e.components};return n?(0,i.jsx)(n,{...e,children:(0,i.jsx)(h,{...e})}):h(e)}},8453:(e,n,t)=>{t.d(n,{R:()=>o,x:()=>c});var i=t(6540);const s={},r=i.createContext(s);function o(e){const n=i.useContext(r);return i.useMemo((function(){return"function"==typeof e?e(n):{...n,...e}}),[n,e])}function c(e){let n;return n=e.disableParentContext?"function"==typeof e.components?e.components(s):e.components||s:o(e.components),i.createElement(r.Provider,{value:n},e.children)}}}]);