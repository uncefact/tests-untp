import * as pulumi from "@pulumi/pulumi";
import { configureBase, createStateBucket, deployApp } from './infra';

//const {backendUrl, stateBucket} = createStateBucket();
//const secretProviderURL = configureBase();
const appURL = deployApp();

//export const backend = backendUrl;
//export const secret = secretProviderURL;

export const url = appURL;