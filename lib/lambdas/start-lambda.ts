import { EC2Client, StartInstancesCommand } from '@aws-sdk/client-ec2'
import { APIGatewayProxyResult } from 'aws-lambda'

const {INSTANCE_ID: instanceId, REGION: region} = process.env

export const handler = async (): Promise<APIGatewayProxyResult> => {
    let result, statusCode
    try {
        const ec2Result = await spinUpInstance({instanceId, region})
        result = ec2Result.StartingInstances
        ?.find(i => i.InstanceId === instanceId)
        ?.CurrentState?.Name

        statusCode = result ? 200 : 404
        result = result ?? 'not found'

    } catch(e) {
        console.error(`[ERROR] ${e}`)
        statusCode = 500
        result = 'error'
    }

    return {
        statusCode,
        headers: {
            'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({result}),
        isBase64Encoded: false,
    }
}

const spinUpInstance = async ({instanceId, region}: any) => {
    const client = new EC2Client({region})
    const command = new StartInstancesCommand({
        InstanceIds: [instanceId]
    })

    return await client.send(command)
}
