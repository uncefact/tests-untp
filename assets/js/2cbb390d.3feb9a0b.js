"use strict";(self.webpackChunkdocumentation=self.webpackChunkdocumentation||[]).push([[6786],{8481:(e,t,n)=>{n.d(t,{Ay:()=>a,RM:()=>o});var s=n(4848),i=n(8453);const o=[];function r(e){const t={admonition:"admonition",p:"p",...(0,i.R)(),...e.components};return(0,s.jsx)(t.admonition,{type:"info",children:(0,s.jsx)(t.p,{children:"Please note that this content is under development and is not ready for implementation. This status message will be updated as content development progresses."})})}function a(e={}){const{wrapper:t}={...(0,i.R)(),...e.components};return t?(0,s.jsx)(t,{...e,children:(0,s.jsx)(r,{...e})}):r(e)}},8691:(e,t,n)=>{n.r(t),n.d(t,{assets:()=>l,contentTitle:()=>a,default:()=>h,frontMatter:()=>r,metadata:()=>c,toc:()=>d});var s=n(4848),i=n(8453),o=n(8481);const r={sidebar_position:7,title:"Extensions"},a=void 0,c={id:"test-suites/semantic-interoperability/cli/extensions",title:"Extensions",description:"The United Nations Transparency Protocol (UNTP) allows for extensions to its core data model. The UNTP Semantic Interoperability Test Suite can validate these extensions, ensuring they remain compliant with the core UNTP data model. This enables implementors to prototype and test custom credential types or additional properties while maintaining conformance with the UNTP protocol.",source:"@site/docs/test-suites/semantic-interoperability/cli/extensions.md",sourceDirName:"test-suites/semantic-interoperability/cli",slug:"/test-suites/semantic-interoperability/cli/extensions",permalink:"/tests-untp/docs/test-suites/semantic-interoperability/cli/extensions",draft:!1,unlisted:!1,editUrl:"https://github.com/uncefact/tests-untp/tree/main/docs/test-suites/semantic-interoperability/cli/extensions.md",tags:[],version:"current",sidebarPosition:7,frontMatter:{sidebar_position:7,title:"Extensions"},sidebar:"tutorialSidebar",previous:{title:"Usage",permalink:"/tests-untp/docs/test-suites/semantic-interoperability/cli/usage"},next:{title:"Technical Interoperability",permalink:"/tests-untp/docs/test-suites/technical-interoperability/"}},l={},d=[...o.RM,{value:"Adding a Custom Schema",id:"adding-a-custom-schema",level:2}];function p(e){const t={a:"a",code:"code",h2:"h2",li:"li",ol:"ol",p:"p",pre:"pre",...(0,i.R)(),...e.components};return(0,s.jsxs)(s.Fragment,{children:[(0,s.jsx)(o.Ay,{}),"\n",(0,s.jsxs)(t.p,{children:["The ",(0,s.jsx)(t.a,{href:"https://uncefact.github.io/spec-untp/",children:"United Nations Transparency Protocol (UNTP)"})," allows for extensions to its core data model. The UNTP Semantic Interoperability Test Suite can validate these extensions, ensuring they remain compliant with the core UNTP data model. This enables implementors to prototype and test custom credential types or additional properties while maintaining conformance with the UNTP protocol."]}),"\n",(0,s.jsx)(t.h2,{id:"adding-a-custom-schema",children:"Adding a Custom Schema"}),"\n",(0,s.jsxs)(t.ol,{children:["\n",(0,s.jsx)(t.li,{children:"Create a new directory for your schema:"}),"\n"]}),"\n",(0,s.jsx)(t.pre,{children:(0,s.jsx)(t.code,{children:"packages/\n\u2514\u2500\u2500 untp-test-suite/\n    \u2514\u2500\u2500 src/\n        \u2514\u2500\u2500 schemas/\n            \u2514\u2500\u2500 myCustomCredential/\n                \u2514\u2500\u2500 v0.0.1/\n                    \u2514\u2500\u2500 schema.json\n"})}),"\n",(0,s.jsxs)(t.ol,{start:"2",children:["\n",(0,s.jsxs)(t.li,{children:["\n",(0,s.jsxs)(t.p,{children:["Define your schema in ",(0,s.jsx)(t.code,{children:"schema.json"}),", extending the core UNTP model as needed."]}),"\n"]}),"\n",(0,s.jsxs)(t.li,{children:["\n",(0,s.jsxs)(t.p,{children:["Update ",(0,s.jsx)(t.code,{children:"credentials.json"})," to include your new credential type:"]}),"\n"]}),"\n"]}),"\n",(0,s.jsx)(t.pre,{children:(0,s.jsx)(t.code,{className:"language-json",children:'{\n  "credentials": [\n    // ... existing credentials\n    {\n      "type": "myCustomCredential",\n      "version": "v0.0.1",\n      "dataPath": "credentials/myCustomCredential-sample.json"\n    }\n  ]\n}\n'})}),"\n",(0,s.jsxs)(t.ol,{start:"4",children:["\n",(0,s.jsxs)(t.li,{children:["\n",(0,s.jsx)(t.p,{children:"Create a sample credential file matching your schema."}),"\n"]}),"\n",(0,s.jsxs)(t.li,{children:["\n",(0,s.jsx)(t.p,{children:"Run the test suite to validate your extended credential:"}),"\n"]}),"\n"]}),"\n",(0,s.jsx)(t.pre,{children:(0,s.jsx)(t.code,{className:"language-bash",children:"yarn run untp test\n"})}),"\n",(0,s.jsx)(t.p,{children:"By following these steps, you can prototype extensions to the UNTP data model while ensuring compatibility with the core specification."}),"\n",(0,s.jsxs)(t.p,{children:["Remember to thoroughly test your extensions and consider submitting valuable additions to the ",(0,s.jsx)(t.a,{href:"https://github.com/uncefact/tests-untp",children:"UNTP community"})," for potential inclusion in future versions of the protocol or submit your extension to the ",(0,s.jsx)(t.a,{href:"https://uncefact.github.io/spec-untp/docs/extensions",children:"extensions register"}),"."]})]})}function h(e={}){const{wrapper:t}={...(0,i.R)(),...e.components};return t?(0,s.jsx)(t,{...e,children:(0,s.jsx)(p,{...e})}):p(e)}},8453:(e,t,n)=>{n.d(t,{R:()=>r,x:()=>a});var s=n(6540);const i={},o=s.createContext(i);function r(e){const t=s.useContext(o);return s.useMemo((function(){return"function"==typeof e?e(t):{...t,...e}}),[t,e])}function a(e){let t;return t=e.disableParentContext?"function"==typeof e.components?e.components(i):e.components||i:r(e.components),s.createElement(o.Provider,{value:t},e.children)}}}]);