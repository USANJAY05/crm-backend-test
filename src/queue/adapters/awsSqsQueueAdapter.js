"use strict";
const { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand, GetQueueAttributesCommand } = require("@aws-sdk/client-sqs");
const { createCircuitBreaker } = require("../circuitBreaker");
const { getLogger } = require("../../observability/logger");
const log = getLogger("queue.adapters.awsSqsQueueAdapter");

function parseMap(raw) { const m = {}; for (const p of String(raw || "").split(",")) { const [k,v] = p.split("=").map(x=>x?.trim()); if(k&&v)m[k]=v; } return m; }
function createClient() { return new SQSClient({ region: process.env.AWS_REGION || process.env.AWS_SQS_REGION || "ap-south-1" }); }
function createAwsSqsQueueAdapter() {
  const client = createClient(); const registrations = new Map(); const queueMap = parseMap(process.env.AWS_SQS_QUEUE_MAP); const defaultUrl = process.env.AWS_SQS_QUEUE_URL || ""; let stopped = false;
  const urlFor = type => queueMap[type] || defaultUrl || (()=>{ throw new Error(`[queue] no SQS queue URL configured for job type "${type}"`); })();
  async function publish(type, data) { const job={id:`job_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,data,attempts:0,enqueuedAt:new Date().toISOString()}; await client.send(new SendMessageCommand({QueueUrl:urlFor(type),MessageBody:JSON.stringify(job)})); return job.id; }
  async function consume(type, reg) { while(!stopped) { try { const r=await client.send(new ReceiveMessageCommand({QueueUrl:urlFor(type),MaxNumberOfMessages:Math.min(10,reg.concurrency),WaitTimeSeconds:Number(process.env.AWS_SQS_WAIT_TIME_SECONDS||20),VisibilityTimeout:Number(process.env.AWS_SQS_VISIBILITY_TIMEOUT_SECONDS||300),AttributeNames:["ApproximateReceiveCount"]})); for(const msg of r.Messages||[]) { reg.active++; try { const job=JSON.parse(msg.Body||"{}"); await (reg.breaker?reg.breaker.execute(()=>reg.handler(job.data)):reg.handler(job.data)); await client.send(new DeleteMessageCommand({QueueUrl:urlFor(type),ReceiptHandle:msg.ReceiptHandle})); } catch(e) { log.error(`[queue:${type}] SQS job failed: ${e.message}`); } finally { reg.active--; } } } catch(e) { if(!stopped) { log.error(`SQS consumer ${type} failed: ${e.message}`); await new Promise(r=>setTimeout(r,3000)); } } } }
  return { enqueue: (type,data)=>publish(type,data), process(type,handler,opts={}) { if(registrations.has(type)) throw new Error(`[queue] processor for "${type}" already registered`); const reg={handler,concurrency:opts.concurrency||5,active:0,breaker:opts.circuitBreaker===false?null:createCircuitBreaker(type,opts.circuitBreaker||{})}; registrations.set(type,reg); consume(type,reg); }, async start(){ stopped=false; }, async stop(){ stopped=true; client.destroy(); }, isReady(){return !stopped}, getStats(){ const queues={}; for(const [type,reg] of registrations) queues[type]={active:reg.active,concurrency:reg.concurrency,durable:true,provider:"aws_sqs",queueUrl:urlFor(type)}; return {deadLetterCount:null,deadLetters:[],queues}; } };
}
module.exports={createAwsSqsQueueAdapter};
