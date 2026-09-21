"use strict";
// Deploy this handler as an AWS Lambda with an SQS event source mapping.
exports.handler = async (event) => {
  const failures=[];
  for (const record of event.Records || []) {
    try {
      const job=JSON.parse(record.body || "{}");
      // Route job types to real business handlers here. Keep handlers idempotent.
      console.log(JSON.stringify({type:"crm.sqs.job",jobId:job.id,jobType:job.type}));
    } catch (err) { failures.push({itemIdentifier:record.messageId}); console.error(err); }
  }
  return {batchItemFailures:failures};
};
