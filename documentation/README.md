# Documentation Website

This website is built using [Docusaurus](https://docusaurus.io/), a modern static website generator.

### Prerequisites

- [Node.js](https://nodejs.org/en/) version 20.12.2
- [yarn](https://yarnpkg.com/) version 1.22.22

### Installation

```
$ yarn
```

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

The following environment variables are set in the Dockerfile:

- `PORT`: 3002 (The port on which the application will run)
- `DOCS_URL`: http://0.0.0.0 (The URL for the documentation site)
- `DOCS_BASE_URL`: / (The base URL for the documentation site)

You can override these variables when running the container if needed.

