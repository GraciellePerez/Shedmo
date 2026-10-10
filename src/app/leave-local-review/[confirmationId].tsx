import {useLocalSearchParams} from 'expo-router';
import {LocalSaleReviewScreen} from '@/features/localSales/LocalSaleReviewScreen';
export default function Page(){const{confirmationId}=useLocalSearchParams<{confirmationId:string}>();return <LocalSaleReviewScreen confirmationId={confirmationId}/>;}
