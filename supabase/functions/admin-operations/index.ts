import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.111.0";
import { json, optionsResponse } from "../_shared/http.ts";
import { inspectReport } from "./reportInspection.ts";

const required = (name: string) => { const value=Deno.env.get(name)?.trim(); if(!value) throw new Error(`Missing ${name}`); return value; };
const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const pageOf = (value: unknown) => Math.max(0, Math.min(500, Number.isInteger(value) ? Number(value) : 0));

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return json({ error: "Method not allowed." },405);
  try {
    const url=required("SUPABASE_URL"), serviceKey=required("SUPABASE_SERVICE_ROLE_KEY");
    const token=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"");
    if(!token) return json({error:"Authentication required."},401);
    const auth=createClient(url,required("SUPABASE_ANON_KEY"),{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false}});
    const {data:{user}}=await auth.auth.getUser();
    if(!user) return json({error:"Authentication required."},401);
    const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:staff}=await admin.from("staff_roles").select("role,active").eq("user_id",user.id).maybeSingle();
    if(!staff?.active || !["admin","moderator"].includes(staff.role)) return json({error:"Staff access denied."},403);
    const body=await request.json().catch(()=>null) as Record<string,unknown>|null;
    const operation=typeof body?.operation==="string"?body.operation:"";
    if(operation==="status") return json({role:staff.role});
    if(operation==="dashboard") return json(await dashboard(admin));
    if(operation==="analytics") { const [base,hybrid]=await Promise.all([admin.rpc("get_private_beta_metrics_v1"),admin.rpc("get_hybrid_local_metrics_v1")]);if(base.error)throw base.error;if(hybrid.error)throw hybrid.error;return json({metrics:{...(base.data??{}),...(hybrid.data??{})}}); }
    if(operation==="list_feedback") return json({items:await listFeedback(admin,body)});
    if(operation==="feedback_action") return rpc(admin,"staff_update_beta_feedback_v1",{p_staff_id:user.id,p_feedback_id:id(body?.id),p_status:text(body?.status,20)});
    if(operation==="monitoring") return json({items:await listMonitoring(admin)});
    if(operation==="list_reports") return json({items:await listReports(admin,body)});
    if(operation==="inspect_report") return json(await inspectReport(admin,user.id,id(body?.id)));
    if(operation==="moderate_report_content") return rpc(admin,"staff_suppress_report_content_v1",{p_staff_id:user.id,p_report_id:id(body?.id),p_action:text(body?.action,20),p_note:text(body?.note,500),p_revision:text(body?.revision,32)});
    if(operation==="report_action") return rpc(admin,"staff_moderate_report_v1",{p_staff_id:user.id,p_report_id:id(body?.id),p_action:text(body?.action,30),p_note:optionalText(body?.note,500)});
    if(operation==="list_disputes") return json({items:await listDisputes(admin,body)});
    if(operation==="list_local_sales") return json({items:await listLocalSales(admin,body)});
    if(operation==="resolve_dispute") {
      const disputeId=id(body?.id), resolution=text(body?.resolution,30), note=text(body?.note,1000);
      const {data:orderId,error}=await admin.rpc("staff_resolve_dispute_v1",{p_staff_id:user.id,p_dispute_id:disputeId,p_resolution:resolution,p_note:note});
      if(error) throw error;
      if(resolution==="resolved_buyer") {
        const {data:refund}=await admin.from("order_refunds").select("id,status").eq("order_id",orderId).order("created_at",{ascending:false}).limit(1).maybeSingle();
        if(refund && refund.status!=="succeeded") await admin.functions.invoke("process-order-refund",{body:{refundId:refund.id},headers:{Authorization:`Bearer ${serviceKey}`}});
      }
      return json({status:resolution});
    }
    if(operation==="list_users") return json({items:await listUsers(admin,body)});
    if(operation==="user_action") { if(staff.role!=="admin") return json({error:"Admin access required."},403); return rpc(admin,"staff_moderate_user_v1",{p_staff_id:user.id,p_user_id:id(body?.id),p_action:text(body?.action,30)}); }
    if(operation==="list_listings") return json({items:await listListings(admin,body)});
    if(operation==="listing_action") return rpc(admin,"staff_moderate_listing_v1",{p_staff_id:user.id,p_listing_id:id(body?.id),p_action:text(body?.action,20),p_reason:optionalText(body?.reason,500)});
    if(operation==="list_financial") return json({items:await listFinancial(admin)});
    if(operation==="retry_reconciliation") {
      if(staff.role!=="admin") return json({error:"Admin access required."},403);
      const result=await admin.functions.invoke("reconcile-order-financials",{body:{},headers:{Authorization:`Bearer ${serviceKey}`}});
      if(result.error) throw result.error;
      await admin.rpc("staff_log_reconciliation_retry_v1",{p_staff_id:user.id});
      return json({status:"started"});
    }
    if(operation==="list_audit") return json({items:await listAudit(admin,body)});
    return json({error:"Unsupported operation."},400);
  } catch(error) {
    console.error("Admin operation failed",{code:typeof error==="object"&&error&&"code" in error?String(error.code):"UNKNOWN"});
    const code=typeof error==="object"&&error&&"code" in error?String(error.code):"ADMIN_OPERATION_FAILED";
    return json({error:"Admin operation could not be completed.",code:/^[A-Z0-9_]{1,20}$/.test(code)?code:"ADMIN_OPERATION_FAILED"},409);
  }
});

async function rpc(admin: SupabaseClient,name:string,args:Record<string,unknown>){const {data,error}=await admin.rpc(name,args);if(error)throw error;return json({status:data});}
function id(value:unknown){if(typeof value!=="string"||!uuid.test(value))throw new Error("INVALID_ID");return value;}
function text(value:unknown,max:number){if(typeof value!=="string"||!value.trim()||value.trim().length>max)throw new Error("INVALID_TEXT");return value.trim();}
function optionalText(value:unknown,max:number){return typeof value==="string"&&value.trim()?text(value,max):null;}
async function count(admin:SupabaseClient,table:string,apply?:(q:any)=>any){let q=admin.from(table).select("id",{count:"exact",head:true});if(apply)q=apply(q);const {count}=await q;return count??0;}
async function dashboard(admin:SupabaseClient){return{openReports:await count(admin,"reports",q=>q.in("status",["pending","under_review"])),openDisputes:await count(admin,"order_disputes",q=>q.in("status",["open","awaiting_seller_response","under_review"])),restrictedUsers:await count(admin,"profiles",q=>q.or("staff_sell_restricted.eq.true,account_suspended_at.not.is.null")),hiddenListings:await count(admin,"listings",q=>q.not("moderation_hidden_at","is",null)),financialIssues:(await listFinancial(admin)).length};}
async function listReports(admin:SupabaseClient,body:Record<string,unknown>|null){const from=pageOf(body?.page)*20;let q=admin.from("reports").select("id,report_type,target_id,listing_id,reported_user_id,conversation_id,message_id,review_id,reason,details,status,created_at").order("created_at",{ascending:false}).range(from,from+19);if(typeof body?.status==="string"&&body.status!=="all")q=q.eq("status",body.status);if(typeof body?.search==="string"&&uuid.test(body.search))q=q.or(`id.eq.${body.search},target_id.eq.${body.search}`);const {data,error}=await q;if(error)throw error;return data??[];}
async function listDisputes(admin:SupabaseClient,body:Record<string,unknown>|null){const from=pageOf(body?.page)*20;let q=admin.from("order_disputes").select("id,order_id,buyer_id,seller_id,dispute_type,status,buyer_explanation,seller_response,evidence_paths,opened_at,orders(payment_status,fulfillment_status,refund_status,transfer_status)").order("opened_at",{ascending:false}).range(from,from+19);if(typeof body?.search==="string"&&uuid.test(body.search))q=q.or(`id.eq.${body.search},order_id.eq.${body.search}`);const {data,error}=await q;if(error)throw error;return data??[];}
async function listLocalSales(admin:SupabaseClient,body:Record<string,unknown>|null){const from=pageOf(body?.page)*20;let q=admin.from("local_sale_confirmations").select("id,listing_id,conversation_id,seller_id,buyer_id,status,listing_title_snapshot,listing_price_snapshot,seller_confirmed_at,buyer_confirmed_at,rejected_at,cancelled_at,created_at,updated_at").order("created_at",{ascending:false}).range(from,from+19);if(typeof body?.search==="string"&&uuid.test(body.search))q=q.or(`id.eq.${body.search},listing_id.eq.${body.search},buyer_id.eq.${body.search},seller_id.eq.${body.search}`);const{data,error}=await q;if(error)throw error;return data??[];}
async function listUsers(admin:SupabaseClient,body:Record<string,unknown>|null){const from=pageOf(body?.page)*20;let q=admin.from("profiles").select("id,display_name,username,avatar_url,city,state,created_at,account_suspended_at,staff_sell_restricted").order("created_at",{ascending:false}).range(from,from+19);if(typeof body?.search==="string"&&body.search.trim())q=q.or(`display_name.ilike.%${body.search.trim()}%,username.ilike.%${body.search.trim()}%`);const {data,error}=await q;if(error)throw{code:"USERS_PROFILES"};return Promise.all((data??[]).map(async p=>{const [salesResult,purchasesResult,reviewsResult]=await Promise.all([admin.from("orders").select("id",{count:"exact",head:true}).eq("seller_id",p.id).eq("fulfillment_status","completed"),admin.from("orders").select("id",{count:"exact",head:true}).eq("buyer_id",p.id).eq("fulfillment_status","completed"),admin.from("marketplace_reviews").select("rating").eq("reviewee_id",p.id).eq("direction","buyer_to_seller")]);if(salesResult.error||purchasesResult.error)throw{code:"USERS_ORDERS"};if(reviewsResult.error)throw{code:"USERS_REVIEWS"};const ratings=(reviewsResult.data??[]).map(review=>Number(review.rating));return{...p,completed_sales:salesResult.count??0,completed_purchases:purchasesResult.count??0,average_rating:ratings.length?ratings.reduce((sum,rating)=>sum+rating,0)/ratings.length:null,total_reviews:ratings.length};}));}
async function listListings(admin:SupabaseClient,body:Record<string,unknown>|null){const from=pageOf(body?.page)*20;let q=admin.from("listings").select("id,title,status,seller_id,created_at,moderation_hidden_at,moderation_reason").order("created_at",{ascending:false}).range(from,from+19);if(typeof body?.search==="string"&&body.search.trim())q=uuid.test(body.search)?q.eq("id",body.search):q.ilike("title",`%${body.search.trim()}%`);const {data,error}=await q;if(error)throw error;return data??[];}
async function listFinancial(admin:SupabaseClient){const [payments,payouts,refunds,reversals,adjustments]=await Promise.all([admin.from("payments").select("id,order_id,processing_fee_status,updated_at").in("processing_fee_status",["reconciling","manual_review"]).limit(50),admin.from("seller_payout_releases").select("id,order_id,status,updated_at").eq("status","reconciling").limit(50),admin.from("order_refunds").select("id,order_id,status,updated_at").eq("status","reconciling").limit(50),admin.from("transfer_reversals").select("id,order_id,status,updated_at").eq("status","reconciling").limit(50),admin.from("seller_financial_adjustments").select("id,order_id,status,remaining_amount,created_at").in("status",["pending","reserved"]).limit(50)]);return[["processing_fee",payments.data],["payout",payouts.data],["refund",refunds.data],["reversal",reversals.data],["adjustment",adjustments.data]].flatMap(([type,rows])=>(rows as any[]??[]).map(row=>({type,...row})));}
async function listFeedback(admin:SupabaseClient,body:Record<string,unknown>|null){const from=pageOf(body?.page)*20;let q=admin.from("marketplace_beta_feedback").select("id,user_id,category,description,status,reviewed_by,reviewed_at,created_at").order("created_at",{ascending:false}).range(from,from+19);if(typeof body?.status==="string"&&body.status!=="all")q=q.eq("status",body.status);const{data,error}=await q;if(error)throw error;return data??[];}
async function listMonitoring(admin:SupabaseClient){const financial=await listFinancial(admin);const[{data:errors,error},{data:runs,error:runError},{data:webhooks,error:webhookError}]=await Promise.all([admin.from("marketplace_operational_errors").select("id,source,error_code,operation,safe_metadata,created_at").order("created_at",{ascending:false}).limit(50),admin.from("marketplace_reconciliation_runs").select("id,status,safe_result,started_at,finished_at").order("started_at",{ascending:false}).limit(25),admin.from("stripe_webhook_events").select("event_type,processing_status,attempt_count,updated_at").eq("processing_status","failed").order("updated_at",{ascending:false}).limit(25)]);if(error||runError||webhookError)throw error??runError??webhookError;const now=Date.now();return[...financial.map(item=>({...item,stale_minutes:Math.floor((now-new Date(String((item as any).updated_at??(item as any).created_at)).getTime())/60000)})),...(runs??[]).map(item=>({type:"reconciliation_run",...item,stale_minutes:item.status==="running"?Math.floor((now-new Date(item.started_at).getTime())/60000):0})),...(webhooks??[]).map(item=>({type:"webhook_failure",...item})),...(errors??[]).map(item=>({type:"operational_error",...item}))];}
async function listAudit(admin:SupabaseClient,body:Record<string,unknown>|null){const from=pageOf(body?.page)*30;const {data,error}=await admin.from("staff_action_log").select("id,staff_user_id,action_type,target_type,target_id,safe_metadata,created_at").order("created_at",{ascending:false}).range(from,from+29);if(error)throw error;return data??[];}
