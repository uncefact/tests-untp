import * as pulumi from "@pulumi/pulumi";
import { configureBase, createStateBucket, deployApp } from './infra';

//TODO: refactor - bakend state bucket and and kms key for secrets provider needs to be moved to a separate stack
const {backendUrl, stateBucket} = createStateBucket();
//const secretProviderURL = configureBase();
const appURL = deployApp();

//export const backend = backendUrl;
//export const secret = secretProviderURL;

export const url = appURL;