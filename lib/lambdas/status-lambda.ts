import { EC2Client, DescribeInstanceStatusCommand } from '@aws-sdk/client-ec2'
import { APIGatewayProxyResult } from 'aws-lambda'

const {INSTANCE_ID: instanceId, REGION: region} = process.env

export const handler = async (): Promise<APIGatewayProxyResult> => {
    let result, statusCode
    try {
        const ec2Result = await describeInstances({instanceId, region})
        result = ec2Result.InstanceStatuses
        ?.find(i => i.InstanceId === instanceId)
        ?.InstanceState?.Name
        statusCode = result ? 200 : 404
        result = result ?? 'not found'
    }
    catch(e) {
        console.error(`[ERROR] ${e}`)
        statusCode = 500
        result = 'error'
    }

    return { 
        statusCode,
        headers: {
            'Access-Control-Allow-Origin': '*',
        },
        body:JSON.stringify({result}),
        isBase64Encoded: false,
    }
}

const describeInstances = async({instanceId, region}: any) => {
    const client = new EC2Client({region})
    const command = new DescribeInstanceStatusCommand({
        IncludeAllInstances: true,
        InstanceIds: [instanceId],
    })

    return await client.send(command)
}