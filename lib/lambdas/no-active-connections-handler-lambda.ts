// if event['detail']['state']['value'] == 'ALARM':
// ec2 = boto3.client('ec2')
// response = ec2.stop_instances(InstanceIds=['<Instance-ID>'])
// return response

import { EC2Client, StopInstancesCommand } from "@aws-sdk/client-ec2"

const { INSTANCE_ID : instanceId, REGION: region } = process.env

export const handler = async(event: any) => {

    let result
    try {
        // if the alarm state is "ALARM", stop the EC2 instance
        if(event.detail.state.value === "ALARM") {
            console.log(`Stopping EC2 instance: ${instanceId}`)
        }

        const ec2Result = await spinDownInstance({instanceId, region})
        result = ec2Result.StoppingInstances
        ?.find(i => i.InstanceId === instanceId)
        ?.CurrentState?.Name

        if(!result) {
            console.log(`No EC2 instance found running with id ${instanceId}`)
        }

    }
    catch(e)
    {
        console.log(`Error managing EC2 instances: ${e}`)
    }
}

const spinDownInstance = async ({instanceId, region} : any) => {

    const client = new EC2Client({region})
    const command = new StopInstancesCommand({
        InstanceIds: [instanceId]
    })

    return await client.send(command)
}