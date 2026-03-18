import { Stack, StackProps, CfnOutput, Aws } from 'aws-cdk-lib';
import {
    aws_iam as iam,
    aws_s3 as s3,
    aws_lambda as lambda,
    aws_s3objectlambda as s3ObjectLambda,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

// configurable variables
const S3_ACCESS_POINT_NAME = 'example-test-ap'

export class S3ObjectLambdaStack extends Stack {
    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        const accessPoint = `arn:aws:s3:${Aws.REGION}:${Aws.ACCOUNT_ID}:accesspoint/${S3_ACCESS_POINT_NAME}`;

        // Set up a bucket
        const bucket = new s3.Bucket(this, 'example-bucket', {
            accessControl: s3.BucketAccessControl.BUCKET_OWNER_FULL_CONTROL,
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL
        });

        // Delegating access control to access points
        // https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-points-policies.html
        bucket.addToResourcePolicy(new iam.PolicyStatement({
                actions: ['*'],
                principals: [new iam.AnyPrincipal()],
                resources: [
                    bucket.bucketArn,
                    bucket.arnForObjects('*')
                ],
                conditions: {
                    'StringEquals':
                        {
                            's3:DataAccessPointAccount': `${Aws.ACCOUNT_ID}`
                        }
                }
            }
        ));

        // lambda to process our objects during retrieval
        const excelExtractorLambda = new lambda.Function(this, 'excelExtractorLambda', {
                runtime: lambda.Runtime.PYTHON_3_14,
                handler: 'index.main',
                code: lambda.Code.fromAsset('pythonCode')
            }
        );

        // lambda to process our objects during retrieval
        const excelRetrievalLambda = new lambda.Function(this, 'excelRetrievalLambda', {
                runtime: lambda.Runtime.PYTHON_3_14,
                handler: 'index.main',
                code: lambda.Code.fromAsset('OtherPythonCode')
            }
        );

        // Allow Extractor to read Excel in s3
        excelExtractorLambda.addToRolePolicy(new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                resources: ['*'],
                actions: ['s3:GetObject']
            }
        ));

        // Allow Retriever to put Excel in s3
        excelRetrievalLambda.addToRolePolicy(new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                resources: ['*'],
                actions: ['s3:PutObject']
            }
        ));
        excelRetrievalLambda.addToRolePolicy(new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                resources: ['*'],
                actions: ['rds:ConnectAndWrite'] // can't find this, it's always more complicated than that.
            }
        ));

        // Restrict Lambda to be invoked from own account
        excelExtractorLambda.addPermission('invocationRestriction', {
            action: 'lambda:InvokeFunction',
            principal: new iam.AccountRootPrincipal(),
            sourceAccount: Aws.ACCOUNT_ID
        });

        // Associate Bucket's access point with lambda get access
        const policyDoc = new iam.PolicyDocument({
            statements: [
                new iam.PolicyStatement({
                    sid: 'AllowLambdaToUseAccessPoint',
                    effect: iam.Effect.ALLOW,
                    actions: ['s3:GetObject'],
                    principals: [
                        new iam.ArnPrincipal(<string>excelExtractorLambda.role?.roleArn)
                    ],
                    resources: [`${accessPoint}/object/*`]
                })
            ]
        });

        new s3.CfnAccessPoint(this, 'exampleBucketAP', {
                bucket: bucket.bucketName,
                name: S3_ACCESS_POINT_NAME,
                policy: policyDoc
            }
        );

        new CfnOutput(this, 'exampleBucketArn', { value: bucket.bucketArn });
        new CfnOutput(this, 'objectLambdaArn', { value: excelExtractorLambda.functionArn });
        new CfnOutput(this, 'objectLambdaArn', { value: excelRetrievalLambda.functionArn });
    }
}