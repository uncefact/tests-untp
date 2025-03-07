import type { Config } from '@docusaurus/types';
import 'dotenv/config';
import { themes as prismThemes } from 'prism-react-renderer';

const url = process.env.DOCS_URL || 'http://localhost';
const baseUrl = process.env.DOCS_BASE_URL || '/';
const title = process.env.SITE_TITLE || 'Unnamed Organization';
const siteLogoUrL = process.env.SITE_LOGO_URL || '/img/placeholder-logo-grey.jpg';
const favicon = process.env.FAVICON_URL || 'img/placeholder-logo-grey.jpg';
const organizationName = process.env.ORGANIZATION_NAME || 'uncefact';
const projectName = process.env.PROJECT_NAME || 'Unnamed Project';
const heroImageUrl = process.env.HERO_IMAGE_URL || '/img/placeholder-logo-grey.jpg';
const navbarTitle = process.env.NAVBAR_TITLE || 'Doc';
const editUrl = process.env.EDIT_URL_BASE || 'https://example.com/edit-url';
const slackLink = process.env.SLACK_COMMUNITY_LINK || 'https://example.com/slack-community-link';
const slackChannel = process.env.SLACK_CHANNEL_LINK || 'https://example.com/slack-channel-link';
const repoLink = process.env.REPOSITORY_LINK || 'https://example.com/repo-link';
const altTextImages = process.env.ALT_TEXT_IMAGES || 'Unnamed alt text images';

const config: Config = {
  title,
  tagline: 'A comprehensive suite of tools for testing conformance to the UNTP Specification.',
  favicon,

  url,
  baseUrl,

  organizationName,
  projectName,

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
          editUrl,
        },
        blog: false,
        theme: {
          customCss: [require.resolve('./src/css/custom.scss'), require.resolve('./src/css/index.scss')],
        },
      },
    ],
  ],

  plugins: ['docusaurus-plugin-sass'],

  themes: ['@docusaurus/theme-mermaid'],

  themeConfig: {
    slackLink,
    repoLink: repoLink,
    colorMode: {
      disableSwitch: true,
    },
    image: heroImageUrl,
    navbar: {
      title: navbarTitle,
      logo: {
        alt: altTextImages,
        src: siteLogoUrL,
      },
      items: [
        { to: '/docs/introduction', label: 'Introduction', position: 'right' },
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
        { to: 'https://uncefact.github.io/spec-untp/docs/extensions/', label: 'Extensions', position: 'right' },
        {
          to: repoLink,
          label: 'Contribute',
          position: 'right',
        },
        {
          href: slackChannel,
          position: 'right',
          html: '<svg class="icon icon-slack"><use xlink:href="#slack"></use></svg><span class="menu-item-name">Slack</span>',
          className: 'navbar-slack-link',
        },
        {
          href: repoLink,
          html: '<svg class="icon"><use xlink:href="#github"></use></svg><span class="menu-item-name">Github</span>',
          className: 'navbar-github-link',
          position: 'right',
        },
        {
          type: 'docsVersionDropdown',
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
              href: slackChannel,
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'GitHub',
              href: repoLink,
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
  },
};

export default config;
