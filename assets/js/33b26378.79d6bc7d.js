"use strict";(self.webpackChunkdocumentation=self.webpackChunkdocumentation||[]).push([[3769],{8481:(e,t,n)=>{n.d(t,{Ay:()=>c,RM:()=>r});var i=n(4848),o=n(8453);const r=[];function s(e){const t={admonition:"admonition",p:"p",...(0,o.R)(),...e.components};return(0,i.jsx)(t.admonition,{type:"info",children:(0,i.jsx)(t.p,{children:"Please note that this content is under development and is not ready for implementation. This status message will be updated as content development progresses."})})}function c(e={}){const{wrapper:t}={...(0,o.R)(),...e.components};return t?(0,i.jsx)(t,{...e,children:(0,i.jsx)(s,{...e})}):s(e)}},6578:(e,t,n)=>{n.r(t),n.d(t,{assets:()=>a,contentTitle:()=>c,default:()=>h,frontMatter:()=>s,metadata:()=>d,toc:()=>l});var i=n(4848),o=n(8453),r=n(8481);const s={sidebar_position:40,title:"Identify Key Path"},c=void 0,d={id:"mock-apps/common/identifier-key-path",title:"Identify Key Path",description:"Description",source:"@site/docs/mock-apps/common/identifier-key-path.md",sourceDirName:"mock-apps/common",slug:"/mock-apps/common/identifier-key-path",permalink:"/tests-untp/docs/mock-apps/common/identifier-key-path",draft:!1,unlisted:!1,editUrl:"https://github.com/uncefact/tests-untp/tree/main/docs/mock-apps/common/identifier-key-path.md",tags:[],version:"current",sidebarPosition:40,frontMatter:{sidebar_position:40,title:"Identify Key Path"},sidebar:"tutorialSidebar",previous:{title:"Default Verification Service Link",permalink:"/tests-untp/docs/mock-apps/common/default-verification-service-link"},next:{title:"Issuing Credential",permalink:"/tests-untp/docs/mock-apps/common/issuing-credential"}},a={},l=[...r.RM,{value:"Description",id:"description",level:2},{value:"Example",id:"example",level:2},{value:"Definition for object",id:"definition-for-object",level:2}];function p(e){const t={a:"a",code:"code",h2:"h2",p:"p",pre:"pre",table:"table",tbody:"tbody",td:"td",th:"th",thead:"thead",tr:"tr",...(0,o.R)(),...e.components};return(0,i.jsxs)(i.Fragment,{children:[(0,i.jsx)(r.Ay,{}),"\n",(0,i.jsx)(t.h2,{id:"description",children:"Description"}),"\n",(0,i.jsxs)(t.p,{children:["The ",(0,i.jsx)(t.code,{children:"IdentifierKeyPath"})," is a property of services that interact with the data issued to get the identifier to be used for the ",(0,i.jsx)(t.a,{href:"/docs/mock-apps/common/idr",children:"IDR"})," registration. It can be a JSON path of the identifier of the data issued or an object that contains the function ",(0,i.jsx)(t.code,{children:"concatService"})," and the ",(0,i.jsx)(t.code,{children:"args"})," to be used to get the identifier."]}),"\n",(0,i.jsx)(t.h2,{id:"example",children:"Example"}),"\n",(0,i.jsx)(t.pre,{children:(0,i.jsx)(t.code,{className:"language-json",children:'{\n  "identifierKeyPath": "/eventID"\n}\n'})}),"\n",(0,i.jsx)(t.p,{children:"or"}),"\n",(0,i.jsx)(t.pre,{children:(0,i.jsx)(t.code,{className:"language-json",children:'{\n  "identifierKeyPath": {\n    "function": "concatService",\n    "args": [\n      { "type": "text", "value": "(01)" },\n      { "type": "path", "value": "/productIdentifier/0/identifierValue" },\n      { "type": "text", "value": "(10)" },\n      { "type": "path", "value": "/batchIdentifier/0/identifierValue" },\n      { "type": "text", "value": "(21)" },\n      { "type": "path", "value": "/itemIdentifier/0/identifierValue" }\n    ]\n  }\n}\n'})}),"\n",(0,i.jsx)(t.h2,{id:"definition-for-object",children:"Definition for object"}),"\n",(0,i.jsxs)(t.table,{children:[(0,i.jsx)(t.thead,{children:(0,i.jsxs)(t.tr,{children:[(0,i.jsx)(t.th,{children:"Property"}),(0,i.jsx)(t.th,{style:{textAlign:"center"},children:"Required"}),(0,i.jsx)(t.th,{children:"Description"}),(0,i.jsx)(t.th,{children:"Type"})]})}),(0,i.jsxs)(t.tbody,{children:[(0,i.jsxs)(t.tr,{children:[(0,i.jsx)(t.td,{children:"function"}),(0,i.jsx)(t.td,{style:{textAlign:"center"},children:"Yes"}),(0,i.jsx)(t.td,{children:"The concat function supported"}),(0,i.jsx)(t.td,{children:"String"})]}),(0,i.jsxs)(t.tr,{children:[(0,i.jsx)(t.td,{children:"args"}),(0,i.jsx)(t.td,{style:{textAlign:"center"},children:"Yes"}),(0,i.jsxs)(t.td,{children:["The array of object that can be ",(0,i.jsx)(t.code,{children:"text"})," or ",(0,i.jsx)(t.code,{children:"path"})]}),(0,i.jsx)(t.td,{children:"Array"})]})]})]})]})}function h(e={}){const{wrapper:t}={...(0,o.R)(),...e.components};return t?(0,i.jsx)(t,{...e,children:(0,i.jsx)(p,{...e})}):p(e)}},8453:(e,t,n)=>{n.d(t,{R:()=>s,x:()=>c});var i=n(6540);const o={},r=i.createContext(o);function s(e){const t=i.useContext(r);return i.useMemo((function(){return"function"==typeof e?e(t):{...t,...e}}),[t,e])}function c(e){let t;return t=e.disableParentContext?"function"==typeof e.components?e.components(o):e.components||o:s(e.components),i.createElement(r.Provider,{value:t},e.children)}}}]);