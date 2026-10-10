import { requireSupabase } from '@/lib/supabase/client';
import { telemetry } from '@/services/telemetry';

export type LocalSaleStatus = 'pending_buyer_confirmation'|'confirmed'|'rejected'|'cancelled';
export interface LocalSale { id:string;listingId:string;conversationId:string;sellerId:string;buyerId:string;sellerName:string;status:LocalSaleStatus;title:string;price:number;createdAt:string; }
export interface EligibleBuyer { conversationId:string;buyerId:string;buyerName:string;lastMessageAt:string|null; }

export async function fetchEligibleLocalBuyers(listingId:string):Promise<EligibleBuyer[]> {
  const {data,error}=await requireSupabase().rpc('get_direct_local_sale_buyers_v1',{p_listing_id:listingId});
  if(error)throw error;
  return (data??[]).map((row:Record<string,unknown>)=>({conversationId:String(row.conversation_id),buyerId:String(row.buyer_id),buyerName:String(row.buyer_name),lastMessageAt:row.last_message_at as string|null}));
}
export async function fetchLocalSales(listingId:string):Promise<LocalSale[]> {
  const {data,error}=await requireSupabase().from('local_sale_confirmations').select('id,listing_id,conversation_id,seller_id,buyer_id,status,listing_title_snapshot,listing_price_snapshot,created_at,seller:profiles!local_sale_confirmations_seller_id_fkey(display_name,username)').eq('listing_id',listingId).order('created_at',{ascending:false});
  if(error)throw error;return (data??[]).map(row=>{const seller=Array.isArray(row.seller)?row.seller[0]:row.seller;return{id:row.id,listingId:row.listing_id,conversationId:row.conversation_id,sellerId:row.seller_id,buyerId:row.buyer_id,sellerName:seller?.display_name?.trim()||seller?.username?.trim()||'the seller',status:row.status,title:row.listing_title_snapshot,price:Number(row.listing_price_snapshot),createdAt:row.created_at};});
}
export async function startLocalSale(listingId:string,conversationId:string){const{data,error}=await requireSupabase().rpc('start_direct_local_sale_v1',{p_listing_id:listingId,p_conversation_id:conversationId});if(error)throw error;telemetry.track('local_direct_sale_started','local_sale',String(data));return String(data);}
export async function respondLocalSale(id:string,confirm:boolean){const{error}=await requireSupabase().rpc('respond_direct_local_sale_v1',{p_confirmation_id:id,p_confirm:confirm});if(error)throw error;telemetry.track(confirm?'local_direct_sale_confirmed':'local_direct_sale_rejected','local_sale',id);}
export async function cancelLocalSale(id:string){const{error}=await requireSupabase().rpc('cancel_direct_local_sale_v1',{p_confirmation_id:id});if(error)throw error;}
export async function markLocalListingDisposition(listingId:string,disposition:'sold_elsewhere'|'unavailable'){
  const{error}=await requireSupabase().rpc('mark_local_listing_disposition_v2',{p_listing_id:listingId,p_disposition:disposition});
  if(error)throw error;
}
