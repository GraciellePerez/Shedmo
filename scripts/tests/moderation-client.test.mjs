import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function repository(client = {}) {
  const source = readFileSync('src/features/messaging/services/messagingRepository.ts','utf8');
  const compiled = ts.transpileModule(`${source}\nexport { mapConversation };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => {
    if (name.includes('supabase/client')) return { requireSupabase: () => client };
    if (name.includes('listingRepository')) return { mapDatabaseListing: async value => value };
    if (name.includes('telemetry')) return { telemetry: { track() {} } };
    throw new Error(`Unexpected import ${name}`);
  } });
  return exports;
}
const row = {
  id:'conversation',listing_id:'hidden-listing',buyer_id:'buyer',seller_id:'seller',listing:null,
  buyer:{id:'buyer',display_name:'Buyer'},seller:{id:'seller',display_name:'Seller'},
  created_at:'2026-09-15T00:00:00Z',last_message_at:null,
  messages:[{id:'message',sender_id:'seller',body:'Legitimate history',created_at:'2026-09-15T00:00:00Z'}],
};

test('hidden listing joins produce a safe conversation placeholder without losing messages or participants',async()=>{
  const result = await repository().mapConversation(row,'buyer',1);
  assert.equal(result.listing.unavailable,true);
  assert.equal(result.listing.title,'Listing unavailable');
  assert.equal(result.listing.image,'');
  assert.equal(result.participant.id,'seller');
  assert.equal(result.messages[0].text,'Legitimate history');
  assert.equal(result.unread,1);
});
test('normal conversation listing data remains intact',async()=>{
  const result = await repository().mapConversation({...row,listing:{id:'listing',title:'Drill',price:25,image:'photo',pickup:true}},'buyer',0);
  assert.equal(result.listing.unavailable,false);
  assert.equal(result.listing.price,25);assert.equal(result.listing.image,'photo');
});
test('message UPDATE events use the replacement callback rather than new-message delivery',async()=>{
  const handlers=[];let inserts=0;let updated;
  const query={select:()=>query,eq:()=>query,order:()=>query,limit:()=>query,maybeSingle:async()=>({data:row,error:null})};
  const channel={on:(_type,filter,callback)=>{handlers.push({filter,callback});return channel;},subscribe:()=>channel};
  const repo=repository({from:()=>query,rpc:async()=>({data:[],error:null}),channel:()=>channel});
  await repo.subscribeToConversationMessages('conversation','buyer',()=>inserts++,undefined,message=>{updated=message;});
  const handler=handlers.find(item=>item.filter.event==='UPDATE');
  assert.equal(handler.filter.filter,'conversation_id=eq.conversation');
  handler.callback({new:{id:'message',sender_id:'seller',body:'[Message removed by Shedmo]',created_at:'2026-09-15T00:00:00Z'}});
  assert.equal(inserts,0);assert.equal(updated.text,'[Message removed by Shedmo]');
});
test('client review reports send only the review ID and preserve the existing listing-report RPC',async()=>{
  const source=readFileSync('src/features/reports/services/reportRepository.ts','utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};const calls=[];
  vm.runInNewContext(compiled,{exports,require:name=>name.includes('supabase/client')
    ? {requireSupabase:()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:'submitted',error:null};}})}
    : {telemetry:{track(){}}}});
  assert.equal(await exports.submitContentReport({type:'review',targetId:'review'},'inappropriate',' Details '),'submitted');
  assert.equal(calls[0].name,'submit_review_report_v1');
  assert.equal(JSON.stringify(calls[0].args),JSON.stringify({p_review_id:'review',p_reason:'inappropriate',p_details:'Details'}));
  await exports.submitContentReport({type:'listing',targetId:'listing'},'other','Details');
  assert.equal(calls[1].name,'submit_content_report');
});
