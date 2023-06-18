#!/usr/bin/env node
import 'source-map-support/register'
require('dotenv').config()
const crypto = require('crypto')

import * as cdk from 'aws-cdk-lib'

import { TerrariaServerStack } from '../lib/terraria-server-stack'


const keyName = process.env.KEYNAME ?? ''

if(!keyName) {
    throw 'Should have the name of your IAM keypair in the .env file'
}

const app = new cdk.App()
new TerrariaServerStack(app, 'Default', {
    keyName,
    env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
})
