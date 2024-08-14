"use strict";(self.webpackChunkdocumentation=self.webpackChunkdocumentation||[]).push([[9036],{8481:(e,n,i)=>{i.d(n,{Ay:()=>r,RM:()=>s});var t=i(4848),o=i(8453);const s=[];function c(e){const n={admonition:"admonition",p:"p",...(0,o.R)(),...e.components};return(0,t.jsx)(n.admonition,{type:"info",children:(0,t.jsx)(n.p,{children:"Please note that this content is under development and is not ready for implementation. This status message will be updated as content development progresses."})})}function r(e={}){const{wrapper:n}={...(0,o.R)(),...e.components};return n?(0,t.jsx)(n,{...e,children:(0,t.jsx)(c,{...e})}):c(e)}},2014:(e,n,i)=>{i.r(n),i.d(n,{assets:()=>a,contentTitle:()=>r,default:()=>h,frontMatter:()=>c,metadata:()=>l,toc:()=>d});var t=i(4848),o=i(8453),s=i(8481);const c={sidebar_position:8,title:"Configuration"},r=void 0,l={id:"mock-apps/configuration/index",title:"Configuration",description:"The Mock Apps config file is used to define the system level config, the apps within the mock app system, the apps functions and the connection to the external services.",source:"@site/docs/mock-apps/configuration/index.md",sourceDirName:"mock-apps/configuration",slug:"/mock-apps/configuration/",permalink:"/tests-untp/docs/mock-apps/configuration/",draft:!1,unlisted:!1,editUrl:"https://github.com/uncefact/tests-untp/tree/main/docs/mock-apps/configuration/index.md",tags:[],version:"current",sidebarPosition:8,frontMatter:{sidebar_position:8,title:"Configuration"},sidebar:"tutorialSidebar",previous:{title:"Identity Resolver Service",permalink:"/tests-untp/docs/mock-apps/dependent-services/identity-resolution-service"},next:{title:"System",permalink:"/tests-untp/docs/mock-apps/configuration/system-config"}},a={},d=[...s.RM,{value:"Example Configuration",id:"example-configuration",level:2},{value:"Pre-configured Services",id:"pre-configured-services",level:3},{value:"Updating the Issuer",id:"updating-the-issuer",level:3},{value:"Mock App Configuration File Lifecycle",id:"mock-app-configuration-file-lifecycle",level:2},{value:"Location of the Configuration File",id:"location-of-the-configuration-file",level:3},{value:"Modifying the Configuration File",id:"modifying-the-configuration-file",level:3},{value:"Applying Configuration Changes",id:"applying-configuration-changes",level:3},{value:"Important Notes",id:"important-notes",level:3}];function p(e){const n={code:"code",h2:"h2",h3:"h3",li:"li",ol:"ol",p:"p",pre:"pre",ul:"ul",...(0,o.R)(),...e.components};return(0,t.jsxs)(t.Fragment,{children:[(0,t.jsx)(s.Ay,{}),"\n",(0,t.jsx)(n.p,{children:"The Mock Apps config file is used to define the system level config, the apps within the mock app system, the apps functions and the connection to the external services."}),"\n",(0,t.jsx)(n.h2,{id:"example-configuration",children:"Example Configuration"}),"\n",(0,t.jsxs)(n.p,{children:["The ",(0,t.jsx)(n.code,{children:"app-config.json"}),' file in the root directory contains an example configuration for a value chain called "Truffle". This configuration is pre-set to work with the services created by the Docker Compose setup.']}),"\n",(0,t.jsx)(n.h3,{id:"pre-configured-services",children:"Pre-configured Services"}),"\n",(0,t.jsx)(n.p,{children:"Most of the service endpoints in the example configuration are already set to use the Docker Compose services. The only endpoint you might need to change is the Identity Resolver Service (IDR) endpoint."}),"\n",(0,t.jsxs)(n.ul,{children:["\n",(0,t.jsxs)(n.li,{children:["By default, the IDR service endpoint is set to ",(0,t.jsx)(n.code,{children:"http://localhost:8080"}),"."]}),"\n",(0,t.jsxs)(n.li,{children:["If you've changed this endpoint, update the ",(0,t.jsx)(n.code,{children:"dlr"})," values in the config file accordingly."]}),"\n"]}),"\n",(0,t.jsx)(n.h3,{id:"updating-the-issuer",children:"Updating the Issuer"}),"\n",(0,t.jsxs)(n.p,{children:["You will need to update the ",(0,t.jsx)(n.code,{children:"issuer"})," property value (did",":web",") inside the ",(0,t.jsx)(n.code,{children:"vckit"})," object. This should be set to the identifier you created using the Verifiable Credential Service."]}),"\n",(0,t.jsx)(n.p,{children:"For example:"}),"\n",(0,t.jsx)(n.pre,{children:(0,t.jsx)(n.code,{className:"language-json",children:'"vckit": {\n  "issuer": "did:web:your-created-identifier"\n}\n'})}),"\n",(0,t.jsx)(n.h2,{id:"mock-app-configuration-file-lifecycle",children:"Mock App Configuration File Lifecycle"}),"\n",(0,t.jsx)(n.p,{children:"The Mock App system can be tailored to model different value chains using a configuration file. This section explains the lifecycle of this configuration file and how to apply changes."}),"\n",(0,t.jsx)(n.h3,{id:"location-of-the-configuration-file",children:"Location of the Configuration File"}),"\n",(0,t.jsxs)(n.p,{children:["The configuration file is named ",(0,t.jsx)(n.code,{children:"app-config.json"})," and is located in the root directory of the cloned repository. To navigate to this directory, use the following command:"]}),"\n",(0,t.jsx)(n.pre,{children:(0,t.jsx)(n.code,{className:"language-bash",children:"cd tests-untp\n"})}),"\n",(0,t.jsx)(n.h3,{id:"modifying-the-configuration-file",children:"Modifying the Configuration File"}),"\n",(0,t.jsxs)(n.ol,{children:["\n",(0,t.jsxs)(n.li,{children:["Open the ",(0,t.jsx)(n.code,{children:"app-config.json"})," file."]}),"\n",(0,t.jsx)(n.li,{children:"Make the necessary modifications to tailor the Mock App system to your desired value chain."}),"\n",(0,t.jsx)(n.li,{children:"Save the changes to the file."}),"\n"]}),"\n",(0,t.jsx)(n.h3,{id:"applying-configuration-changes",children:"Applying Configuration Changes"}),"\n",(0,t.jsx)(n.p,{children:"For the modifications to take effect in the Mock Apps, follow these steps:"}),"\n",(0,t.jsxs)(n.ol,{children:["\n",(0,t.jsx)(n.li,{children:"If the Mock App system is currently running, stop it."}),"\n",(0,t.jsxs)(n.li,{children:["After saving the changes to ",(0,t.jsx)(n.code,{children:"app-config.json"}),", restart the Mock App system using the following command:"]}),"\n"]}),"\n",(0,t.jsx)(n.pre,{children:(0,t.jsx)(n.code,{className:"language-bash",children:"yarn start\n"})}),"\n",(0,t.jsx)(n.h3,{id:"important-notes",children:"Important Notes"}),"\n",(0,t.jsxs)(n.ul,{children:["\n",(0,t.jsx)(n.li,{children:"Changes to the configuration file will not be reflected in the mock apps until you restart the Mock App system."}),"\n",(0,t.jsxs)(n.li,{children:["Always ensure you save the ",(0,t.jsx)(n.code,{children:"app-config.json"})," file before restarting the Mock App system."]}),"\n",(0,t.jsxs)(n.li,{children:["If you're using the Docker Compose setup, most service endpoints are pre-configured. You only need to update the ",(0,t.jsx)(n.code,{children:"issuer"})," property in the ",(0,t.jsx)(n.code,{children:"vckit"})," object and potentially the IDR service endpoint if you've changed it from the default."]}),"\n"]})]})}function h(e={}){const{wrapper:n}={...(0,o.R)(),...e.components};return n?(0,t.jsx)(n,{...e,children:(0,t.jsx)(p,{...e})}):p(e)}},8453:(e,n,i)=>{i.d(n,{R:()=>c,x:()=>r});var t=i(6540);const o={},s=t.createContext(o);function c(e){const n=t.useContext(s);return t.useMemo((function(){return"function"==typeof e?e(n):{...n,...e}}),[n,e])}function r(e){let n;return n=e.disableParentContext?"function"==typeof e.components?e.components(o):e.components||o:c(e.components),t.createElement(s.Provider,{value:n},e.children)}}}]);