# Current CRM infrastructure

## Runtime
- Backend: Docker container on an OCI Compute VM.
- Redis: Docker container on the same VM (`redis:6379`).
- MySQL: Oracle MySQL service.
- Object storage: OCI Object Storage through its S3 Compatibility API.
- Queue: OCI Queue (`QUEUE_PROVIDER=oci_queue`).
- Authentication: AWS Cognito.
- AI: Google Vertex AI, with organization-scoped GCP projects/credentials.
- API Gateway: not used currently.

## OCI Queue
OCI Queue is managed and durable. The backend uses the OCI JavaScript SDK and supports instance-principal authentication on an OCI Compute VM. OCI Queue provides visibility timeouts and server-side dead-letter handling. Configure `OCI_QUEUE_OCID` or `OCI_QUEUE_MAP`.

For a VM running in OCI, prefer:

```env
OCI_AUTH_MODE=instance_principal
OCI_QUEUE_REGION=ap-hyderabad-1
```

Do not put an OCI private API key in the container when Instance Principal is available. Configure a dynamic group and IAM policy for the VM to use the queue.

## OCI Object Storage S3 compatibility
Use an OCI Customer Secret Key as the S3 access/secret pair. The endpoint format is:

`https://<namespace>.compat.objectstorage.<region>.oraclecloud.com`

The AWS SDK S3 client is retained, with path-style access enabled. Keep call recordings private and use signed URLs.

## Scheduler
The existing scheduler process remains the local timing engine when `SCHEDULER_PROVIDER=local`. For a fully managed OCI scheduler, use OCI Resource Scheduler/OCI Functions to trigger the backend's protected scheduler endpoint. OCI Resource Scheduler is designed around OCI resources/functions rather than arbitrary HTTP requests, so an OCI Function is the bridge for application schedules.

The endpoint is:

`POST /internal/scheduler/:id/run`

with `x-scheduler-secret: <SCHEDULER_TRIGGER_SECRET>`.

The endpoint can only execute pre-registered schedule IDs; it cannot execute arbitrary code.
