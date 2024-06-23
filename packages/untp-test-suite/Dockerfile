FROM node:20.12.2
WORKDIR /app

COPY . .

RUN yarn install
RUN yarn add @types/node @types/lodash @types/semver --dev
RUN yarn add nodemon --dev

RUN yarn build

RUN yarn run build

RUN yarn run untp

RUN yarn run untp config

RUN yarn run untp test

CMD ["yarn", "nodemon", "--watch", ".", "--ext", "js,ts,json", "--exec", "yarn run untp test"]
