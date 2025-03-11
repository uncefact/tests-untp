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
ENV PORT=3002 \
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

The site can be configured using environment variables found in the [.env.example](.env.example) file. Create a `.env` file in the same directory or set them directly in your environment.

| Environment Variable             | Description                                    | Default Value                             |
|----------------------------------|------------------------------------------------|-------------------------------------------|
| `PORT`                           | Port on which the application runs             | `3000`                                    |
| `DOCS_URL`                       | URL for the documentation site                 | `http://localhost`                          |
| `DOCS_BASE_URL`                  | Base path for the documentation site           | `/`                                       |
| `SITE_TITLE`                     | Title of the documentation site                | `Example Organization`                    |
| `SITE_TAGLINE`                   | Tagline displayed on the site                  | `Example tagline`                         |
| `SITE_LOGO_URL`                  | URL for the site logo                          | `img/placeholder-logo-grey.jpg`           |
| `ORGANIZATION_NAME`              | Name of the organization                       | `Example Organization`                    |
| `PROJECT_NAME`                   | Name of the project                            | `Unnamed Project`                         |
| `FAVICON_URL`                    | URL for the site favicon                       | `img/placeholder-logo-grey.jpg`           |
| `HERO_IMAGE_URL`                 | URL for the hero image                         | `img/placeholder-logo-grey.jpg`           |
| `HERO_IMAGE_ALT`                 | Alt text for the hero image                    | `Hero image`                              |
| `NAVBAR_TITLE`                   | Title displayed in the navigation bar          | `Doc`                                     |
| `EDIT_URL_BASE`                  | Base URL for edit links                        | `https://example.com/edit-url`            |
| `REPOSITORY_LINK`                | URL to the project repository                  | `https://example.com/repo-link`           |
| `SLACK_COMMUNITY_LINK`           | URL to the Slack community                     | `https://example.com/slack-community-link`|
| `ALT_TEXT_IMAGES`                | Default alt text for images                    | `Unnamed alt text images`                 |
| `EXTENSION_DOCS_LINK`            | URL to extension documentation                 | `https://example.com/extension-docs-link` |
| `FOOTER_TITLE`                   | Title displayed in the footer                  | `Example Footer`                          |
| `FOOTER_TEXT`                    | Text displayed in the footer                   | `Example Footer`                          |
| `FOOTER_SPEC_TITLE`              | Title for the specification link in the footer | `Specification`                           |
| `FOOTER_SPEC_LINK`               | URL to the specification documentation         | `https://example.com/footer-spec-link`    |
