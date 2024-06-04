# tests-untp

UNTP mock implementation is a mock app that presents how the decentralized app works. There are three main packages in this repository: components, core, and services. The components package contains the UI components, the core package plays the role of the render page by using the components package and interacting with the services package and the services package contains the business logic.


## Install dependencies

```bash
yarn install
```

## Build the package

```bash
yarn build
```

## Start the project

```bash
yarn start
```
## Docker

* Dockerfile
Build image
```bash
docker build --build-arg CONFIG_FILE=./app-config.json -t mock-app:latest .
```
Run image
```bash
docker run -p 3000:80 mock-app:latest
```
* Docker compose
```bash
docker-compose up
```