import type { Config } from '@docusaurus/types';
import 'dotenv/config';
import { themes as prismThemes } from 'prism-react-renderer';

const url = process.env.DOCS_URL || 'http://localhost';
const baseUrl = process.env.DOCS_BASE_URL || '/';
const title = process.env.DOCS_SITE_TITLE || 'Example Organization';
const siteLogoUrL = process.env.DOCS_SITE_LOGO_URL || 'img/grey-placeholder-image.png';
const siteLogoAlt = process.env.DOCS_SITE_LOGO_ALT || 'Example alt text';
const favicon = process.env.DOCS_FAVICON_URL || 'img/grey-placeholder-image.png';
const organizationName = process.env.DOCS_ORGANIZATION_NAME || 'Example Organization';
const projectName = process.env.DOCS_PROJECT_NAME || 'Unnamed Project';
const heroImageUrl = process.env.DOCS_HERO_IMAGE_URL || 'img/grey-placeholder-image.png';
const navbarTitle = process.env.DOCS_NAVBAR_TITLE || 'Doc';
const editUrl = process.env.DOCS_EDIT_URL_BASE || 'https://example.com/edit-url';
const slackLink = process.env.DOCS_SLACK_COMMUNITY_LINK || 'https://example.com/slack-community-link';
const repoLink = process.env.DOCS_REPOSITORY_LINK || 'https://example.com/repo-link';
const heroImageAlt = process.env.DOCS_HERO_IMAGE_ALT || 'Hero image';
const tagline = process.env.DOCS_SITE_TAGLINE || 'Example tagline';
const extensionsLink = process.env.DOCS_EXTENSIONS_LINK || 'https://example.com/extensions-link';
const footerTitle = process.env.DOCS_FOOTER_TITLE || 'Example Footer';
const footerSpecTitle = process.env.DOCS_FOOTER_SPEC_TITLE || 'Specification';
const footerSpecLink = process.env.DOCS_FOOTER_SPEC_LINK || 'https://example.com/footer-spec-link';
const copyrightText = process.env.DOCS_COPYRIGHT_TEXT || 'Example Copyright Text';

const config: Config = {
  title,
  tagline,
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
          editUrl: ({ versionDocsDirPath, docPath }) => `${editUrl}/${versionDocsDirPath}/${docPath}`,
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
    heroImage: heroImageUrl,
    heroImageAlt,
    navbar: {
      title: navbarTitle,
      logo: {
        alt: siteLogoAlt,
        src: siteLogoUrL,
      },
      items: [
        { to: '/docs/introduction', label: 'Introduction', position: 'right' },
        {
          to: '/docs/reference-implementation/',
          label: 'Getting started',
          position: 'right',
        },
        {
          to: '/docs/reference-implementation/',
          label: 'Tools and support',
          position: 'right',
        },
        { to: extensionsLink, label: 'Extensions', position: 'right' },
        {
          to: repoLink,
          label: 'Contribute',
          position: 'right',
        },
        {
          href: slackLink,
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
              to: '/docs/reference-implementation/',
            },
          ],
        },
        {
          title: 'Test Suites and Tools',
          items: [
            {
              label: 'Reference Implementation',
              to: '/docs/reference-implementation/',
            },
            {
              label: 'Technical Interoperability',
              to: '/docs/reference-implementation/',
            },
            {
              label: 'Semantic Interoperability',
              to: '/docs/reference-implementation/',
            },
            {
              label: 'Graph Validation',
              to: '/docs/reference-implementation/',
            },
          ],
        },
        {
          title: footerTitle,
          items: [
            {
              label: footerSpecTitle,
              href: footerSpecLink,
            },
            {
              label: 'Slack Channel',
              href: slackLink,
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
      copyright: `© ${copyrightText}`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  },
};

export default config;
