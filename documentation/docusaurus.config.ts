import type { Config } from '@docusaurus/types';
import { themes as prismThemes } from 'prism-react-renderer';

const url = process.env.DOCS_URL || 'http://localhost';
const baseUrl = process.env.DOCS_BASE_URL || '/';

const config: Config = {
  title: 'UN Transparency Protocol Test Suite',
  tagline: 'A comprehensive suite of tools for testing conformance to the UNTP Specification.',
  favicon: 'img/favicon.ico',

  url,
  baseUrl,

  organizationName: 'uncefact', // Replace with your GitHub org/user name
  projectName: 'tests-untp', // Replace with your repo name

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  markdown: {
    mermaid: true,
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/uncefact/tests-untp/tree/main/',
        },
        blog: false,
        theme: {
          customCss: [
            require.resolve('./src/css/custom.scss'),
            require.resolve('./src/css/index.scss'),
          ],
        },
      } 
    ],
  ],

  plugins: ['docusaurus-plugin-sass'],

  themes: ['@docusaurus/theme-mermaid'],

  themeConfig: {
    slackLink:
    'https://join.slack.com/t/uncefact/shared_invite/zt-1d7hd0js1-sS1Xgk8DawQD9VgRvy1QHQ',
    repoLink: 'https://github.com/uncefact/tests-untp',
    colorMode: {
      disableSwitch: true,
    },
  image: 'img/un-crm-social-card.png',    
  navbar: {
      title: 'TP',
      logo: {
        alt: 'UNTP Test Suite Logo',
        src: 'img/logo.svg',
      },
      items: [
        {to: '/docs/introduction', label: 'Introduction', position: 'right'},
        {
          to: '/docs/mock-apps/',
          label: 'Getting started',
          position: 'right',
        },
        {
          to: '/docs/mock-apps/',
          label: 'Tools and support',
          position: 'right',
        },
        {to: 'https://uncefact.github.io/spec-untp/docs/extensions/', label: 'Extensions', position: 'right'},
        {
          to: 'https://github.com/uncefact/tests-untp',
          label: 'Contribute',
          position: 'right',
        },
        {
          href: 'https://app.slack.com/client/T03KNUD7LHZ/C05R8DD2AKZ',
          position: 'right',
          html: '<svg class="icon icon-slack"><use xlink:href="#slack"></use></svg><span class="menu-item-name">Slack</span>',
          className: 'navbar-slack-link',
        },
        {
          href: 'https://github.com/uncefact/tests-untp',
          html: '<svg class="icon"><use xlink:href="#github"></use></svg><span class="menu-item-name">Github</span>',
          className: 'navbar-github-link',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Introduction',
              to: '/docs/introduction',
            },
            {
              label: 'Getting Started',
              to: '/docs/mock-apps/',
            },
          ],
        },
        {
          title: 'Test Suites and Tools',
          items: [
            {
              label: 'Mock Apps',
              to: '/docs/mock-apps/',
            },
            {
              label: 'Technical Interoperability',
              to: '/docs/mock-apps/',
            },
            {
              label: 'Semantic Interoperability',
              to: '/docs/mock-apps/',
            },
            {
              label: 'Graph Validation',
              to: '/docs/mock-apps/',
            },
          ],
        },
        {
          title: 'UN Transparency Protocol',
          items: [
            {
              label: 'UNTP Specification',
              href: 'https://uncefact.github.io/spec-untp/',
            },
            {
              label: 'Slack Channel',
              href: 'https://app.slack.com/client/T03KNUD7LHZ/C05R8DD2AKZ',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/uncefact/tests-untp',
            },
          ],
        },
      ],
      copyright: `© United Nations Economic Commission for Europe`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  }
};

export default config;
