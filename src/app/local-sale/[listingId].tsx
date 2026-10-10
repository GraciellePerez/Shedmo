import {useLocalSearchParams} from 'expo-router';
import {LocalSaleScreen} from '@/features/localSales/LocalSaleScreen';
export default function Page(){const{listingId}=useLocalSearchParams<{listingId:string}>();return <LocalSaleScreen listingId={listingId}/>;}
