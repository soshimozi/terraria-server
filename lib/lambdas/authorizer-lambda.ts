require('dotenv').config({silent: true})

import * as jwt from 'jsonwebtoken'
import jwksClient from "jwks-rsa"

import {promisify} from 'util'

const {ISSUER: issuer, REGION: region, JWS_URI: jwksUri, AUDIENCE: audience} = process.env

const client = jwksClient({
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 10,
    jwksUri: jwksUri ?? ''
})

const getSigningKey = promisify(client.getSigningKey)

export const handler = async(event : any, context : any) => {

    const match = event.authorizationToken.match(/^Bearer (.*)$/)
    if(!match || match.length < 2) {
        throw new Error(`Invalid Authorization token - '${event.authorizationToken}' does not match 'Bearer .*'`)
    }

    const token = match[1]

    const decoded = jwt.decode(token, {complete: true})
    const kid = decoded?.header.kid

    const signingKey = await getSigningKey(kid)

    try {
        const response = await verifyToken(token, signingKey?.getPublicKey() ?? '', audience ?? '', issuer ?? '', event.methodArn)
        return response;
    }
    catch(e) {
        throw new Error(`Failed to verify token - '${event.authorizationToken}': ${e}`)
    }
}

const verifyToken = async(token: string, signingKey: string, audience: string, issuer: string, methodArn: string) => {
    return new Promise((resolve, reject) => {

        const options = {
            audience,
            issuer
        }

        jwt.verify(token, signingKey, options, (err, decoded: any) => {
            if(err) return reject(err)

            const response = {
                principalId: decoded.sub,
                policyDocument: getPolicyDocument('Allow', methodArn),
                context:  {
                    scope: decoded.scope
                }
            }

            resolve(response)
        })
    })
}

const getPolicyDocument = (action: string, methodArn: string) => {
    return {
        Version: '2012-10-17',
        Statement: [
            {
                Action: 'execute-api:Invoke',
                Effect: action,
                Resource: methodArn
            }
        ]
    }
}
