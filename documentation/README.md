# Documentation Website

This website is built using [Docusaurus](https://docusaurus.io/), a modern static website generator.

### Prerequisites

- [Node.js](https://nodejs.org/en/) version 20.12.2
- [yarn](https://yarnpkg.com/) version 1.22.22

### Installation

```
$ yarn
```

### Configuration

By default, this project uses placeholder values for all required environment variables. You can start developing right away without any manual configuration. When you're ready to customize, you can adjust environment variables as explained in the [Environment Variables](#environment-variables) section.

### Local Development

```
$ yarn start
```

This command starts a local development server and opens up a browser window. Most changes are reflected live without having to restart the server.

### Build

```
$ yarn build
```

This command generates static content into the `build` directory and can be served using any static contents hosting service.

### Docker

This documentation site can be run in a Docker container. Below are the instructions for setting up and running the documentation site using Docker.

### Building the Docker Image

By default, the Dockerfile sets these environment variables:

```bash
ENV DOCS_PORT=3002 \
    DOCS_URL=http://0.0.0.0 \
    DOCS_BASE_URL=/
```

You can override these variables when running the container if needed.

To build the Docker image, run the following command in the `documentation` directory of the project:

```bash
docker build -t tests-untp-docs-app .
```

Replace `tests-untp-docs-app` if your prefer a different image name.

#### Running the Container

After building the image, you can run the container using:

```bash
docker run -d -p 3002:3002 tests-untp-docs-app
```

This command maps port 3002 of the container to port 3002 on your host machine.

#### Accessing the Application

Once the container is running, you can access the documentation site by opening a web browser and navigating to:

```
http://localhost:3002
```

#### Environment Variables

The site can be configured using a `.env` file. Copy the [.env.example](.env.example) file and rename it to `.env`. Adjust the values within the file as you need.

#### Core Configuration

| Environment Variable     | Description                          | Default Value                    |
| ------------------------ | ------------------------------------ | -------------------------------- |
| `DOCS_PORT`              | Port on which the application runs   | `3002`                           |
| `DOCS_URL`               | URL for the documentation site       | `http://localhost`               |
| `DOCS_BASE_URL`          | Base path for the documentation site | `/`                              |
| `DOCS_SITE_TITLE`        | Title of the documentation site      | `Example Organization`           |
| `DOCS_SITE_TAGLINE`      | Tagline displayed on the site        | `Example tagline`                |
| `DOCS_FAVICON_URL`       | URL for the site favicon             | `img/grey-placeholder-image.png` |
| `DOCS_ORGANIZATION_NAME` | Name of the organization             | `Example Organization`           |
| `DOCS_PROJECT_NAME`      | Name of the project                  | `Unnamed Project`                |

#### Content & Branding

| Environment Variable     | Description                                      | Default Value                    |
| ------------------------ | ------------------------------------------------ | -------------------------------- |
| `DOCS_NAVBAR_TITLE`      | Title displayed in the navigation bar            | `Doc`                            |
| `DOCS_SITE_LOGO_URL`     | URL for the site logo                            | `img/grey-placeholder-image.png` |
| `DOCS_SITE_LOGO_ALT`     | Alt text for site logo                           | `Example alt text`               |
| `DOCS_HERO_IMAGE_URL`    | URL for the hero image                           | `img/grey-placeholder-image.png` |
| `DOCS_HERO_IMAGE_ALT`    | Alt text for the hero image                      | `Hero image`                     |
| `DOCS_FOOTER_TITLE`      | Title displayed in the footer                    | `Example Footer`                 |
| `DOCS_FOOTER_SPEC_TITLE` | Title for the specification link in the footer   | `Specification`                  |
| `DOCS_COPYRIGHT_TEXT`    | Text displayed in the footer's copyright section | `Example copyright text`         |

#### External Links

| Environment Variable        | Description                            | Default Value                              |
| --------------------------- | -------------------------------------- | ------------------------------------------ |
| `DOCS_EDIT_URL_BASE`        | Base URL for edit links                | `https://example.com/edit-url`             |
| `DOCS_REPOSITORY_LINK`      | URL to the project repository          | `https://example.com/repo-link`            |
| `DOCS_SLACK_COMMUNITY_LINK` | URL to the Slack community             | `https://example.com/slack-community-link` |
| `DOCS_EXTENSIONS_LINK`      | URL to extension documentation         | `https://example.com/extensions-link`      |
| `DOCS_FOOTER_SPEC_LINK`     | URL to the specification documentation | `https://example.com/footer-spec-link`     |
