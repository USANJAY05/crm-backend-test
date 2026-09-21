"use strict";
// Deploy this handler behind an EventBridge rule or Scheduler target.
exports.handler = async (event) => {
  console.log(JSON.stringify({type:"crm.eventbridge.event",source:event.source,detailType:event['detail-type'],detail:event.detail}));
  return {ok:true};
};
