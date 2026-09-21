"use strict";
const { EventBridgeClient, PutEventsCommand } = require("@aws-sdk/client-eventbridge");
let client;
function getClient(){ return client ||= new EventBridgeClient({region:process.env.AWS_REGION||"ap-south-1"}); }
async function publishEvent(detailType, detail, source=process.env.AWS_EVENTBRIDGE_SOURCE||"chiefvoice.crm") {
  const result=await getClient().send(new PutEventsCommand({Entries:[{EventBusName:process.env.AWS_EVENTBRIDGE_BUS_NAME||"default",Source:source,DetailType:detailType,Detail:JSON.stringify(detail)}]}));
  if(result.FailedEntryCount) throw new Error(`EventBridge publish failed: ${JSON.stringify(result.Entries)}`);
  return result.Entries?.[0]?.EventId;
}
module.exports={publishEvent};
