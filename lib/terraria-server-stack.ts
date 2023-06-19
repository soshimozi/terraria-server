require('dotenv').config()
import * as path from 'path'
import { readFileSync, existsSync } from 'fs'

import * as cdk from 'aws-cdk-lib'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch'
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

import { Topic } from 'aws-cdk-lib/aws-sns'
import { Duration } from 'aws-cdk-lib'

const generation = ec2.AmazonLinuxGeneration.AMAZON_LINUX_2

// The type you want will be based mostly on:
//  - The arch built for the docker image.
//  - The performance that architecture is best suited for.
interface InstanceTypes {
    [index: string]: {
        instanceClass: ec2.InstanceClass
        cpuType: ec2.AmazonLinuxCpuType
    }
}

// Add to this list for more options.
const instanceTypes : InstanceTypes = {
    // AMD64
    t3a: {
        instanceClass: ec2.InstanceClass.T3A,
        cpuType : ec2.AmazonLinuxCpuType.X86_64
    },
  // ARM64
  t4g: {
    instanceClass: ec2.InstanceClass.BURSTABLE4_GRAVITON,
    cpuType: ec2.AmazonLinuxCpuType.ARM_64
  }
}


interface TerrariaServerStackProps extends cdk.StackProps {
      // The IAM keypair associated with your root account or ideally your IAM user you use the CLI with.
      keyName: string
      serverDomainName: string,
      apiKey: string,
      apiSecret: string,
      issuer: string,
      jwksUri: string,
      audience: string,
      // (Optional) The name of the world file
      worldFileName?: string // Default 'world.wld'
      // (Optional) Container type/size
      instanceType?: string
      instanceSize?: ec2.InstanceSize,
      s3Files?: string,
      overwriteServerFiles?: boolean
  
}

export class TerrariaServerStack extends cdk.Stack {
    constructor(scope: any, id: string, props: TerrariaServerStackProps) {
        const app = 'TerrariaServer'
        const service = `${app}-${id}`
        super(scope, service, props)

        const {
            keyName,
            serverDomainName,
            apiKey,
            apiSecret,
            issuer,
            jwksUri,
            audience,
            s3Files,
            overwriteServerFiles,
        } = props

        const {region} = this

        const instanceType = props.instanceType || 't3a'
        const instanceSize = props.instanceSize || ec2.InstanceSize.SMALL    
        const worldFileName = props.worldFileName || 'world.wld'

        const {instanceClass, cpuType} = instanceTypes[instanceType]

        // Secrets Manager
        const secret = new secretsmanager.Secret(this, `${service}-ApiSecret`, {
            generateSecretString: {
              secretStringTemplate: JSON.stringify({ apiKey, apiSecret }),
              generateStringKey: 'password',
            },
        });

        // S3
        const bucket = new s3.Bucket(this, 'ServerFiles', {versioned: true})
        const assetFiles = s3Files || ""

        if (assetFiles && existsSync(assetFiles)) {
            new s3deploy.BucketDeployment(this, `${service}DeployFiles`, {
                sources: [s3deploy.Source.asset(assetFiles)],
                destinationBucket: bucket,
                prune: Boolean(overwriteServerFiles)
            })
        }        

        const commands = readFileSync(path.join(__dirname, 'user-data.sh'), 'utf8')
        const commandsReplaced = commands
            .replace(new RegExp('s3BucketName', 'g'), bucket.bucketName)
            .replace(new RegExp('worldFileName', 'g'), worldFileName)
            .replace(new RegExp('regionName', 'g'), region)
            .replace(new RegExp('secretName', 'g'), secret.secretName)
            .replace(new RegExp('domainName', 'g'), serverDomainName)
            .replace(new RegExp('subDomainName', 'g'), 'terraria')

        const userData = ec2.UserData.forLinux()
        userData.addCommands(commandsReplaced)

        const vpc = ec2.Vpc.fromLookup(this, "VPC", {isDefault: true})
        
        const securityGroup = new ec2.SecurityGroup(this, `${service}-SecurityGroup`, {
            vpc,
            description: 'Access to the server ports for ec2 instance'
        })

        securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(7777), 'Allow servier connects')
        securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.udp(7777), `Allow server connections`)
        securityGroup.addIngressRule(ec2.Peer.ipv4("108.243.149.75/32"), ec2.Port.tcp(22), 'Allow ssh connections')
        
        const ec2Instance = new ec2.Instance(this, 'Server', {
            vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
            instanceType: ec2.InstanceType.of(instanceClass, instanceSize),
            keyName,
            machineImage: new ec2.AmazonLinuxImage({
                generation,
                cpuType,
            }),
            securityGroup,
            userData,
            userDataCausesReplacement: true,            
        })

        // ec2 access S3
        ec2Instance.role?.attachInlinePolicy(new iam.Policy(this, `${service}-AccessS3`, {
            document: new iam.PolicyDocument({
                statements: [new iam.PolicyStatement({
                    actions: ['s3:*'],
                    resources: [bucket.bucketArn, `${bucket.bucketArn}/*`],
                })],
            }),
        }))        

        // ec2 access secrets manager
        ec2Instance.role?.attachInlinePolicy(new iam.Policy(this, `${service}-AccessSecretsManager`, {
            document: new iam.PolicyDocument({
                statements: [new iam.PolicyStatement({
                    actions: ['secretsmanager:GetSecretValue'],
                    resources: [secret.secretArn]
                })],
            }),
        }))

        const {instanceId} = ec2Instance

        // Lambdas
        const lambdaDir = path.join(__dirname, 'lambdas')

        const startLambda = new lambda.NodejsFunction(this, `${service}-StartServerLambda`, {
            entry: path.join(lambdaDir, 'start-lambda.ts'),
            handler: 'handler',
            functionName: `${service}-StartServerLambda`,
            environment: {
                'INSTANCE_ID': instanceId,
                'REGION': region,
            },
        })

        startLambda.role
        ?.attachInlinePolicy( new iam.Policy(this, `${service}-StartEc2Policy`, {
            document: new iam.PolicyDocument({
                statements: [new iam.PolicyStatement({
                    actions: ['ec2:StartInstances'],
                    resources: ['*']
                })],
            }),
        }))

        const stopLambda = new lambda.NodejsFunction(this, `${service}-StopServerLambda`, {
            entry: path.join(lambdaDir, 'stop-lambda.ts'),
            handler: 'handler',
            functionName: `${service}-StopServerLambda`,
            environment: {
              'INSTANCE_ID': instanceId,
              'REGION': region,
            },
        })

        stopLambda.role?.attachInlinePolicy(new iam.Policy(this, `${service}-StopEc2Policy`, {
            document: new iam.PolicyDocument({
                statements: [new iam.PolicyStatement({
                    actions: ['ec2:StopInstances'],
                    resources: ['*'],
                })],
            }),
        }))
        
        const statusLambda = new lambda.NodejsFunction(this, `${service}-ServerStatusLambda`, {
            entry: path.join(lambdaDir, 'status-lambda.ts'),
            handler: 'handler',
            functionName: `${service}-ServerStatusLambda`,
            environment: {
                'INSTANCE_ID': instanceId,
                'REGION': region,
            },
        })

        statusLambda.role?.attachInlinePolicy(new iam.Policy(this, `${service}-Ec2StatusPolicy`, {
            document: new iam.PolicyDocument({
                statements: [new iam.PolicyStatement({
                    actions: ['ec2:DescribeInstanceStatus'],
                    resources: ['*'],
                })],
            }),
        }))        


        const noActiveConnectionsLambda = new lambda.NodejsFunction(this, `${service}-NoConnectionAlarmHandlerLambda`, {
            entry: path.join(lambdaDir, 'no-active-connections-handler-lambda.ts'),
            handler: 'handler',
            functionName: `${service}-NoConnectionAlarmHandlerLambda`,
            environment: {
                'INSTANCE_ID': instanceId,
                'REGION': region
            }
        })

        noActiveConnectionsLambda.role?.attachInlinePolicy(new iam.Policy(this, `${service}-StopEC2Policy`, {
            document: new iam.PolicyDocument({
                statements: [new iam.PolicyStatement({
                    actions: ['ec2:StopInstances'],
                    resources: ['*'],
                })],
            }),
        }))

        const authorizerLambda = new lambda.NodejsFunction(this, `${service}-AuthorizerLambda`, {
            entry: path.join(lambdaDir, 'authorizer-lambda.ts'),
            handler: 'handler',
            functionName: `${service}-AuthorizerLambda`,
            environment: {
                'INSTANCE_ID': instanceId,
                'REGION': region,
                'ISSUER': issuer,
                'JWS_URI': jwksUri,
                'AUDIENCE': audience
            },
        }) 

        // API Gateway
        const api = new apigateway.RestApi(this, `${service}-ServerAPI`, {
            defaultCorsPreflightOptions: {
                allowOrigins: apigateway.Cors.ALL_ORIGINS,
                allowMethods: apigateway.Cors.ALL_METHODS,
                allowHeaders: ['Authorization'],
            }
        })

        const authorizer = new apigateway.RequestAuthorizer(this, `${service}-ServerAuthorizer`, {
            handler: authorizerLambda,
            identitySources: [apigateway.IdentitySource.header('Authorization')],
            resultsCacheTtl: Duration.seconds(0),
        })
        
        api.root
        .addResource('start')
        .addMethod('POST', new apigateway.LambdaIntegration(startLambda), { authorizer })

        api.root
        .addResource('stop')
        .addMethod('POST', new apigateway.LambdaIntegration(stopLambda), { authorizer })

        api.root
        .addResource('status')
        .addMethod('GET', new apigateway.LambdaIntegration(statusLambda))
        

        const topic = new Topic(this, `${service}-connections-alarm`)
        topic.addSubscription(new subscriptions.LambdaSubscription(noActiveConnectionsLambda))


        new cloudwatch.Alarm(this, `${service}- No active connections`, {
            metric: new cloudwatch.Metric({
                namespace: 'Custom',
                metricName: 'ActiveConnections',
                statistic: 'SampleCount',
                period: cdk.Duration.minutes(5),
                unit: cloudwatch.Unit.COUNT
            }),
            threshold: 0,
            evaluationPeriods: 2,
            datapointsToAlarm: 2,
            comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_OR_EQUAL_TO_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.MISSING,
            alarmName: `${service}- No active connections`
        }).addAlarmAction(new cloudwatch_actions.SnsAction(topic))        

    }
}