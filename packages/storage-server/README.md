# Storage Server

This is a simple storage server to store JSON data in a file.

## Installation

Requires Node.js version 20 and Yarn verion 1.22.

```bash
yarn install
```

## Usage

To start the server, run the following command:

```bash
yarn start
```

The server will start on port 3000.

## API

```curl
curl --location 'localhost:3000/upload' \
--header 'Content-Type: application/json' \
--data '{
    "data": {"hello": "world"},
    "path": "hello/world.json"
}'
```

```curl

```
