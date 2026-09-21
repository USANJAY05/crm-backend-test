# Scheduler architecture

The backend separates **when a job runs** from **what the job does**.

## Development

Run the API/worker and the dedicated scheduler container:

```text
API + RabbitMQ workers
        ^
        | publish jobs
Dedicated node-cron scheduler
        |
        v
RabbitMQ
```

The scheduler only calls the registered schedule handlers. It never contains telephony/business logic.

## Production with AWS EventBridge Scheduler

Do not run `scheduler.js` in production. Configure two EventBridge Scheduler schedules:

- `crm-auto-dial` -> `POST /internal/scheduler/crm-auto-dial/run`
- `crm-dialer-retry` -> `POST /internal/scheduler/crm-dialer-retry/run`

The HTTP target must send:

```http
X-Scheduler-Secret: <SCHEDULER_TRIGGER_SECRET>
Content-Type: application/json
```

The API validates the secret and only executes schedule IDs that exist in `src/scheduler/definitions.js`.

This keeps the application independent from AWS EventBridge. A future scheduler provider can trigger the same endpoint without changing the queue workers or business logic.

### Required production settings

```env
SCHEDULER_PROVIDER=eventbridge
SCHEDULER_TRIGGER_SECRET=<long-random-secret>
QUEUE_PROVIDER=rabbitmq
```

`SCHEDULER_PROVIDER=eventbridge` is a deployment/configuration declaration; it intentionally does not start a local cron process.
