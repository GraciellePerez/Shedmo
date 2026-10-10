import { requireSupabase } from '@/lib/supabase/client';
export type FeedbackCategory='bug'|'feature_request'|'payment_problem'|'listing_problem'|'messaging_problem'|'other';
export async function submitBetaFeedback(category:FeedbackCategory,description:string){const{data,error}=await requireSupabase().rpc('submit_marketplace_beta_feedback_v1',{p_category:category,p_description:description.trim()});if(error)throw error;return data as string;}
