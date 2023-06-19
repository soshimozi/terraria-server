#!/usr/bin/env node
import 'source-map-support/register'
require('dotenv').config()
const crypto = require('crypto')

import * as cdk from 'aws-cdk-lib'

import { TerrariaServerStack } from '../lib/terraria-server-stack'


const keyName = process.env.KEYNAME ?? ''
const apiKey = process.env.APIKEY ?? ''
const apiSecret = process.env.APISECRET ?? ''
const issuer = process.env.ISSUER ?? ''
const jwksUri = process.env.JWKSURI ?? ''
const audience = process.env.AUDIENCE ?? ''

if(!keyName) {
    throw 'Should have the name of your IAM keypair in the .env file'
}

if(!apiKey) {
    throw 'Should have the name of your api key in the .env file'
}

if(!apiSecret) {
    throw 'Should have the name of your api secret in the .env file'
}

if(!issuer) {
    throw 'Should have the name of your jwt issuer in the .env file'
}

if(!jwksUri) {
    throw 'Should have the jwksUri of your jwt issuer in the .env file'
}

if(!audience) {
    throw 'Should have the audience of your jwt issuer in the .env file'
}

const app = new cdk.App()
new TerrariaServerStack(app, 'Default', {
    keyName,
    apiKey,
    apiSecret,
    issuer,
    audience,
    jwksUri,
    serverDomainName: 'bitwisemobile.com',
    env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
})
