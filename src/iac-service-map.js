/**
 * Infrastructure-as-code resource tables.
 *
 * Maps Terraform `aws_*` resource types and CloudFormation `AWS::*` types onto
 * the service names used by the AWS icon catalog, so an imported stack renders
 * with the same nodes a hand-drawn diagram would use.
 *
 * Each entry has a disposition:
 *
 *  - `node`    — becomes a service on the canvas.
 *  - `skip`    — real infrastructure, but plumbing that would only add noise to
 *                an architecture diagram (IAM policy attachments, subnets, route
 *                tables, listeners). Skipped resources still take part in
 *                reference tracing, so `alb → listener → target group → instance`
 *                still yields a single `alb → instance` edge.
 *
 * `kind` drives the connection type Flow Studio draws (data / event / telemetry
 * / request) and the default criticality of the node.
 */

/** Service kinds → the Flow Studio connection type used to reach them. */
export const KIND_CONNECTION = {
  data: "data",
  event: "event",
  telemetry: "telemetry",
  security: "request",
  compute: "request",
  edge: "request",
  network: "request",
};

/** Default criticality per kind, before fan-in adjustments. */
export const KIND_CRITICALITY = {
  data: "high",
  security: "high",
  edge: "high",
  compute: "medium",
  event: "medium",
  network: "medium",
  telemetry: "low",
};

/**
 * Terraform resource type → catalog service.
 *
 * Keys are exact Terraform types. Longest-prefix fallbacks live in
 * `PREFIX_FALLBACKS` so unrecognised members of a known family still land on
 * the right service.
 */
export const TERRAFORM_TYPES = {
  // Compute
  aws_lambda_function: { service: "AWS Lambda", kind: "compute" },
  aws_instance: { service: "Amazon EC2", kind: "compute" },
  aws_autoscaling_group: { service: "Amazon EC2 Auto Scaling", kind: "compute" },
  aws_eks_cluster: { service: "Amazon Elastic Kubernetes Service", kind: "compute" },
  aws_ecs_cluster: { service: "Amazon Elastic Container Service", kind: "compute" },
  aws_ecs_service: { service: "Amazon Elastic Container Service", kind: "compute" },
  aws_batch_job_definition: { service: "AWS Batch", kind: "compute" },
  aws_apprunner_service: { service: "AWS App Runner", kind: "compute" },

  // Edge / delivery
  aws_cloudfront_distribution: { service: "Amazon CloudFront", kind: "edge" },
  aws_api_gateway_rest_api: { service: "Amazon API Gateway", kind: "edge" },
  aws_apigatewayv2_api: { service: "Amazon API Gateway", kind: "edge" },
  aws_lb: { service: "Elastic Load Balancing", kind: "edge" },
  aws_alb: { service: "Elastic Load Balancing", kind: "edge" },
  aws_elb: { service: "Elastic Load Balancing", kind: "edge" },
  aws_route53_zone: { service: "Amazon Route 53", kind: "edge" },
  aws_globalaccelerator_accelerator: { service: "AWS Global Accelerator", kind: "edge" },
  aws_appsync_graphql_api: { service: "AWS AppSync", kind: "edge" },
  aws_amplify_app: { service: "AWS Amplify", kind: "edge" },

  // Data
  aws_dynamodb_table: { service: "Amazon DynamoDB", kind: "data" },
  aws_s3_bucket: { service: "Amazon Simple Storage Service", kind: "data" },
  aws_rds_cluster: { service: "Amazon Aurora", kind: "data" },
  aws_db_instance: { service: "Amazon RDS", kind: "data" },
  aws_elasticache_cluster: { service: "Amazon ElastiCache", kind: "data" },
  aws_elasticache_replication_group: { service: "Amazon ElastiCache", kind: "data" },
  aws_redshift_cluster: { service: "Amazon Redshift", kind: "data" },
  aws_opensearch_domain: { service: "Amazon OpenSearch Service", kind: "data" },
  aws_elasticsearch_domain: { service: "Amazon OpenSearch Service", kind: "data" },
  aws_neptune_cluster: { service: "Amazon Neptune", kind: "data" },
  aws_docdb_cluster: { service: "Amazon DocumentDB", kind: "data" },
  aws_efs_file_system: { service: "Amazon EFS", kind: "data" },
  aws_timestreamwrite_table: { service: "Amazon Timestream", kind: "data" },

  // Messaging / events / streaming
  aws_sqs_queue: { service: "Amazon Simple Queue Service", kind: "event" },
  aws_sns_topic: { service: "Amazon Simple Notification Service", kind: "event" },
  aws_cloudwatch_event_bus: { service: "Amazon EventBridge", kind: "event" },
  aws_cloudwatch_event_rule: { service: "Amazon EventBridge", kind: "event" },
  aws_sfn_state_machine: { service: "AWS Step Functions", kind: "event" },
  aws_kinesis_stream: { service: "Amazon Kinesis", kind: "event" },
  aws_kinesis_firehose_delivery_stream: { service: "Amazon Data Firehose", kind: "event" },
  aws_msk_cluster: { service: "Amazon Managed Streaming for Apache Kafka", kind: "event" },

  // Security / identity
  aws_iam_role: { service: "AWS Identity and Access Management", kind: "security" },
  aws_cognito_user_pool: { service: "Amazon Cognito", kind: "security" },
  aws_wafv2_web_acl: { service: "AWS WAF", kind: "security" },
  aws_waf_web_acl: { service: "AWS WAF", kind: "security" },
  aws_shield_protection: { service: "AWS Shield", kind: "security" },
  aws_kms_key: { service: "AWS Key Management Service", kind: "security" },
  aws_secretsmanager_secret: { service: "AWS Secrets Manager", kind: "security" },
  aws_acm_certificate: { service: "AWS Certificate Manager", kind: "security" },
  aws_networkfirewall_firewall: { service: "AWS Network Firewall", kind: "security" },

  // Operations / recovery
  aws_cloudwatch_log_group: { service: "Amazon CloudWatch", kind: "telemetry" },
  aws_cloudwatch_dashboard: { service: "Amazon CloudWatch", kind: "telemetry" },
  aws_cloudwatch_metric_alarm: { service: "Amazon CloudWatch", kind: "telemetry" },
  aws_cloudtrail: { service: "AWS CloudTrail", kind: "telemetry" },
  aws_xray_sampling_rule: { service: "AWS X Ray", kind: "telemetry" },
  aws_backup_vault: { service: "AWS Backup", kind: "data" },
  aws_ssm_parameter: { service: "AWS Systems Manager", kind: "security" },

  // Analytics
  aws_glue_job: { service: "AWS Glue", kind: "compute" },
  aws_athena_workgroup: { service: "Amazon Athena", kind: "data" },
  aws_sagemaker_endpoint: { service: "Amazon SageMaker", kind: "compute" },
  aws_bedrock_agent: { service: "Amazon Bedrock", kind: "compute" },

  // Network
  aws_vpc: { service: "Amazon Virtual Private Cloud", kind: "network" },
  aws_ec2_transit_gateway: { service: "AWS Transit Gateway", kind: "network" },
  aws_dx_connection: { service: "AWS Direct Connect", kind: "network" },
  aws_nat_gateway: { service: "NAT Gateway", kind: "network" },
};

/**
 * Terraform families whose members are plumbing rather than architecture.
 *
 * Matched as prefixes after the exact table misses, so
 * `aws_s3_bucket_server_side_encryption_configuration` is skipped while
 * `aws_s3_bucket` still becomes a node.
 */
export const TERRAFORM_SKIP_PREFIXES = [
  "aws_iam_policy",
  "aws_iam_role_policy",
  "aws_iam_instance_profile",
  "aws_iam_user",
  "aws_iam_group",
  "aws_iam_openid",
  "aws_iam_service_linked",
  "aws_s3_bucket_",
  "aws_s3_object",
  "aws_lb_listener",
  "aws_alb_listener",
  "aws_lb_target_group",
  "aws_alb_target_group",
  "aws_lb_ssl",
  "aws_launch_template",
  "aws_launch_configuration",
  "aws_autoscaling_policy",
  "aws_autoscaling_attachment",
  "aws_subnet",
  "aws_route_table",
  "aws_route",
  "aws_internet_gateway",
  "aws_egress_only",
  "aws_vpc_endpoint",
  "aws_vpc_dhcp",
  "aws_network_acl",
  "aws_network_interface",
  "aws_security_group",
  "aws_eip",
  "aws_api_gateway_resource",
  "aws_api_gateway_method",
  "aws_api_gateway_integration",
  "aws_api_gateway_deployment",
  "aws_api_gateway_stage",
  "aws_api_gateway_authorizer",
  "aws_apigatewayv2_route",
  "aws_apigatewayv2_integration",
  "aws_apigatewayv2_stage",
  "aws_apigatewayv2_deployment",
  "aws_lambda_permission",
  "aws_lambda_alias",
  "aws_lambda_layer",
  "aws_lambda_event_source_mapping",
  "aws_lambda_function_url",
  "aws_cloudwatch_event_target",
  "aws_cloudwatch_log_stream",
  "aws_cloudwatch_log_subscription",
  "aws_sns_topic_subscription",
  "aws_sns_topic_policy",
  "aws_sqs_queue_policy",
  "aws_dynamodb_table_item",
  "aws_db_subnet_group",
  "aws_db_parameter_group",
  "aws_rds_cluster_instance",
  "aws_rds_cluster_parameter",
  "aws_elasticache_subnet",
  "aws_elasticache_parameter",
  "aws_ecs_task_definition",
  "aws_ecs_capacity",
  "aws_eks_node_group",
  "aws_eks_addon",
  "aws_kms_alias",
  "aws_kms_grant",
  "aws_acm_certificate_validation",
  "aws_route53_record",
  "aws_route53_health",
  "aws_backup_plan",
  "aws_backup_selection",
  "aws_cognito_user_pool_client",
  "aws_cognito_user_pool_domain",
  "aws_cognito_identity_pool",
  "aws_wafv2_ip_set",
  "aws_wafv2_rule_group",
  "aws_wafv2_web_acl_association",
  "aws_secretsmanager_secret_version",
  "aws_ssm_parameter_",
  "aws_appautoscaling",
  "aws_service_discovery",
  "aws_cloudfront_origin_access",
  "aws_cloudfront_cache_policy",
  "aws_cloudfront_function",
];

/**
 * Prefix → service fallbacks for unrecognised members of a known family.
 * Checked in order, so more specific prefixes must come first.
 */
export const TERRAFORM_PREFIX_FALLBACKS = [
  ["aws_lambda_", { service: "AWS Lambda", kind: "compute" }],
  ["aws_dynamodb_", { service: "Amazon DynamoDB", kind: "data" }],
  ["aws_cloudfront_", { service: "Amazon CloudFront", kind: "edge" }],
  ["aws_apigatewayv2_", { service: "Amazon API Gateway", kind: "edge" }],
  ["aws_api_gateway_", { service: "Amazon API Gateway", kind: "edge" }],
  ["aws_rds_", { service: "Amazon Aurora", kind: "data" }],
  ["aws_elasticache_", { service: "Amazon ElastiCache", kind: "data" }],
  ["aws_opensearch", { service: "Amazon OpenSearch Service", kind: "data" }],
  ["aws_kinesis_firehose", { service: "Amazon Data Firehose", kind: "event" }],
  ["aws_kinesis_", { service: "Amazon Kinesis", kind: "event" }],
  ["aws_cloudwatch_event", { service: "Amazon EventBridge", kind: "event" }],
  ["aws_cloudwatch_", { service: "Amazon CloudWatch", kind: "telemetry" }],
  ["aws_sfn_", { service: "AWS Step Functions", kind: "event" }],
  ["aws_cognito_", { service: "Amazon Cognito", kind: "security" }],
  ["aws_wafv2_", { service: "AWS WAF", kind: "security" }],
  ["aws_backup_", { service: "AWS Backup", kind: "data" }],
  ["aws_ecs_", { service: "Amazon Elastic Container Service", kind: "compute" }],
  ["aws_eks_", { service: "Amazon Elastic Kubernetes Service", kind: "compute" }],
  ["aws_glue_", { service: "AWS Glue", kind: "compute" }],
  ["aws_sagemaker_", { service: "Amazon SageMaker", kind: "compute" }],
  ["aws_bedrock", { service: "Amazon Bedrock", kind: "compute" }],
  ["aws_msk_", { service: "Amazon Managed Streaming for Apache Kafka", kind: "event" }],
];

/**
 * CloudFormation `AWS::Service::Resource` → catalog service.
 * Keyed by the first two segments so every resource in a service family maps
 * without listing each one.
 */
export const CLOUDFORMATION_SERVICES = {
  "AWS::Lambda": { service: "AWS Lambda", kind: "compute" },
  "AWS::EC2": { service: "Amazon EC2", kind: "compute" },
  "AWS::AutoScaling": { service: "Amazon EC2 Auto Scaling", kind: "compute" },
  "AWS::ECS": { service: "Amazon Elastic Container Service", kind: "compute" },
  "AWS::EKS": { service: "Amazon Elastic Kubernetes Service", kind: "compute" },
  "AWS::Batch": { service: "AWS Batch", kind: "compute" },
  "AWS::CloudFront": { service: "Amazon CloudFront", kind: "edge" },
  "AWS::ApiGateway": { service: "Amazon API Gateway", kind: "edge" },
  "AWS::ApiGatewayV2": { service: "Amazon API Gateway", kind: "edge" },
  "AWS::ElasticLoadBalancingV2": { service: "Elastic Load Balancing", kind: "edge" },
  "AWS::ElasticLoadBalancing": { service: "Elastic Load Balancing", kind: "edge" },
  "AWS::Route53": { service: "Amazon Route 53", kind: "edge" },
  "AWS::AppSync": { service: "AWS AppSync", kind: "edge" },
  "AWS::Amplify": { service: "AWS Amplify", kind: "edge" },
  "AWS::DynamoDB": { service: "Amazon DynamoDB", kind: "data" },
  "AWS::S3": { service: "Amazon Simple Storage Service", kind: "data" },
  "AWS::RDS": { service: "Amazon RDS", kind: "data" },
  "AWS::ElastiCache": { service: "Amazon ElastiCache", kind: "data" },
  "AWS::Redshift": { service: "Amazon Redshift", kind: "data" },
  "AWS::OpenSearchService": { service: "Amazon OpenSearch Service", kind: "data" },
  "AWS::Elasticsearch": { service: "Amazon OpenSearch Service", kind: "data" },
  "AWS::Neptune": { service: "Amazon Neptune", kind: "data" },
  "AWS::DocDB": { service: "Amazon DocumentDB", kind: "data" },
  "AWS::EFS": { service: "Amazon EFS", kind: "data" },
  "AWS::Backup": { service: "AWS Backup", kind: "data" },
  "AWS::SQS": { service: "Amazon Simple Queue Service", kind: "event" },
  "AWS::SNS": { service: "Amazon Simple Notification Service", kind: "event" },
  "AWS::Events": { service: "Amazon EventBridge", kind: "event" },
  "AWS::StepFunctions": { service: "AWS Step Functions", kind: "event" },
  "AWS::Kinesis": { service: "Amazon Kinesis", kind: "event" },
  "AWS::KinesisFirehose": { service: "Amazon Data Firehose", kind: "event" },
  "AWS::MSK": { service: "Amazon Managed Streaming for Apache Kafka", kind: "event" },
  "AWS::IAM": { service: "AWS Identity and Access Management", kind: "security" },
  "AWS::Cognito": { service: "Amazon Cognito", kind: "security" },
  "AWS::WAFv2": { service: "AWS WAF", kind: "security" },
  "AWS::WAF": { service: "AWS WAF", kind: "security" },
  "AWS::Shield": { service: "AWS Shield", kind: "security" },
  "AWS::KMS": { service: "AWS Key Management Service", kind: "security" },
  "AWS::SecretsManager": { service: "AWS Secrets Manager", kind: "security" },
  "AWS::CertificateManager": { service: "AWS Certificate Manager", kind: "security" },
  "AWS::NetworkFirewall": { service: "AWS Network Firewall", kind: "security" },
  "AWS::Logs": { service: "Amazon CloudWatch", kind: "telemetry" },
  "AWS::CloudWatch": { service: "Amazon CloudWatch", kind: "telemetry" },
  "AWS::CloudTrail": { service: "AWS CloudTrail", kind: "telemetry" },
  "AWS::XRay": { service: "AWS X Ray", kind: "telemetry" },
  "AWS::SSM": { service: "AWS Systems Manager", kind: "security" },
  "AWS::Glue": { service: "AWS Glue", kind: "compute" },
  "AWS::Athena": { service: "Amazon Athena", kind: "data" },
  "AWS::SageMaker": { service: "Amazon SageMaker", kind: "compute" },
  "AWS::Bedrock": { service: "Amazon Bedrock", kind: "compute" },
};

/** CloudFormation resource types that are plumbing, matched in full. */
export const CLOUDFORMATION_SKIP = [
  "AWS::EC2::Subnet",
  "AWS::EC2::RouteTable",
  "AWS::EC2::Route",
  "AWS::EC2::SubnetRouteTableAssociation",
  "AWS::EC2::InternetGateway",
  "AWS::EC2::VPCGatewayAttachment",
  "AWS::EC2::SecurityGroup",
  "AWS::EC2::SecurityGroupIngress",
  "AWS::EC2::SecurityGroupEgress",
  "AWS::EC2::EIP",
  "AWS::EC2::NetworkInterface",
  "AWS::EC2::VPCEndpoint",
  "AWS::EC2::LaunchTemplate",
  "AWS::IAM::Policy",
  "AWS::IAM::ManagedPolicy",
  "AWS::IAM::InstanceProfile",
  "AWS::IAM::User",
  "AWS::IAM::Group",
  "AWS::Lambda::Permission",
  "AWS::Lambda::EventSourceMapping",
  "AWS::Lambda::Alias",
  "AWS::Lambda::Version",
  "AWS::Lambda::LayerVersion",
  "AWS::ElasticLoadBalancingV2::Listener",
  "AWS::ElasticLoadBalancingV2::ListenerRule",
  "AWS::ElasticLoadBalancingV2::TargetGroup",
  "AWS::ApiGateway::Resource",
  "AWS::ApiGateway::Method",
  "AWS::ApiGateway::Deployment",
  "AWS::ApiGateway::Stage",
  "AWS::ApiGatewayV2::Route",
  "AWS::ApiGatewayV2::Integration",
  "AWS::ApiGatewayV2::Stage",
  "AWS::Events::Rule",
  "AWS::SNS::Subscription",
  "AWS::SNS::TopicPolicy",
  "AWS::SQS::QueuePolicy",
  "AWS::S3::BucketPolicy",
  "AWS::RDS::DBSubnetGroup",
  "AWS::RDS::DBParameterGroup",
  "AWS::ElastiCache::SubnetGroup",
  "AWS::ECS::TaskDefinition",
  "AWS::Route53::RecordSet",
  "AWS::KMS::Alias",
];

/**
 * Attribute names whose reference points at a *parent* rather than a callee.
 *
 * Traffic flows parent → child, but IaC expresses the relationship as
 * `child.parent_attr = parent`. Inverting these attributes is what lets an
 * integration, permission, or event-source mapping be traced through as a
 * single `api → function` or `queue → function` edge.
 *
 * Only attributes that mean "my parent" regardless of who declares them belong
 * here; genuinely ambiguous ones live in {@link PARENT_ATTRIBUTES_BY_TYPE}.
 */
export const INVERTED_ATTRIBUTES = new Set([
  "rest_api_id",
  "restapiid",
  "api_id",
  "apiid",
  "event_bus_name",
  "eventbusname",
  "event_source_arn",
  "eventsourcearn",
  "source_arn",
  "sourcearn",
  "cluster_identifier",
  "distribution_id",
  "user_pool_id",
  "userpoolid",
]);

/**
 * Per-resource-type parent attributes, for names that mean different things
 * depending on who declares them.
 *
 * `target_group_arn` is the clearest case: on a listener it is the
 * *destination* (listener → target group), but on an attachment it is the
 * *parent* (target group → attachment → instance). Getting this wrong breaks
 * the `alb → … → instance` trace entirely, so it is resolved by type.
 */
export const PARENT_ATTRIBUTES_BY_TYPE = {
  aws_lb_listener: ["load_balancer_arn"],
  aws_alb_listener: ["load_balancer_arn"],
  aws_lb_listener_rule: ["listener_arn"],
  aws_alb_listener_rule: ["listener_arn"],
  aws_lb_target_group_attachment: ["target_group_arn"],
  aws_alb_target_group_attachment: ["target_group_arn"],
  aws_autoscaling_attachment: ["autoscaling_group_name", "lb_target_group_arn"],
  aws_sns_topic_subscription: ["topic_arn"],
  aws_sqs_queue_policy: ["queue_url"],
  aws_cloudwatch_event_target: ["rule", "event_bus_name"],
  aws_cloudwatch_log_subscription_filter: ["log_group_name"],
  // A log group named after a function describes logs *for* that function, so
  // telemetry flows function → log group rather than the other way round.
  aws_cloudwatch_log_group: ["name"],
  aws_route53_record: ["zone_id"],
  "AWS::ElasticLoadBalancingV2::Listener": ["loadbalancerarn"],
  "AWS::ElasticLoadBalancingV2::ListenerRule": ["listenerarn"],
  "AWS::Events::Rule": ["eventbusname"],
  "AWS::SNS::Subscription": ["topicarn"],
  "AWS::Route53::RecordSet": ["hostedzoneid"],
};

/**
 * Attributes that express *placement*, not traffic.
 *
 * A load balancer listing its subnets says where it lives, not that it calls
 * them. Drawing those as edges produces confident-looking nonsense like
 * `ALB → VPC`, so references under these attributes are dropped entirely.
 */
export const IGNORED_ATTRIBUTES = new Set([
  "vpc_id",
  "vpcid",
  "subnet_id",
  "subnet_ids",
  "subnets",
  "subnetids",
  "subnetmappings",
  "availability_zone",
  "availability_zones",
  "security_group_ids",
  "security_groups",
  "vpc_security_group_ids",
  "securitygroupids",
  "securitygroups",
  "db_subnet_group_name",
  "cache_subnet_group_name",
]);

/** Signals in a resource body that in-transit or at-rest encryption is off. */
export const PLAINTEXT_SIGNALS = [
  /\bprotocol\s*[=:]\s*"?HTTP"?\s*$/im,
  /"protocol"\s*:\s*"HTTP"/i,
  /viewer_protocol_policy\s*=\s*"allow-all"/i,
  /"ViewerProtocolPolicy"\s*:\s*"allow-all"/i,
  /\bencrypted\s*=\s*false\b/i,
  /"Encrypted"\s*:\s*false/i,
  /storage_encrypted\s*=\s*false/i,
  /"StorageEncrypted"\s*:\s*false/i,
  /transit_encryption_enabled\s*=\s*false/i,
];
