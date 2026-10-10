// Synthetic prototype fixtures; no real accounts or third-party photo URLs.
import type { Listing, SellerInfo } from '@/models';

export const sellers: Record<string, SellerInfo> = {
  s1: { id: 's1', name: 'Demo Seller One', rating: 0, reviews: 0, verified: true, joined: '—', sales: 0, location: 'Austin, TX', responseTime: 'Not available', avatar: 'JR' },
  s2: { id: 's2', name: 'Demo Seller Two', rating: 0, reviews: 0, verified: true, joined: '—', sales: 0, location: 'Denver, CO', responseTime: 'Not available', avatar: 'MT' },
  s3: { id: 's3', name: 'Demo Seller Three', rating: 0, reviews: 0, verified: false, joined: '—', sales: 0, location: 'Portland, OR', responseTime: 'Not available', avatar: 'TW' },
  s4: { id: 's4', name: 'Demo Seller Four', rating: 0, reviews: 0, verified: true, joined: '—', sales: 0, location: 'Chicago, IL', responseTime: 'Not available', avatar: 'CM' },
  s5: { id: 's5', name: 'Demo Seller Five', rating: 0, reviews: 0, verified: true, joined: '—', sales: 0, location: 'Houston, TX', responseTime: 'Not available', avatar: 'AP' },
};

export const listings: Listing[] = [
  {
    id: '1', title: 'Milwaukee M18 FUEL Drill/Driver Kit', price: 189, condition: 'Like New',
    brand: 'Milwaukee', location: 'Austin, TX', distance: '1.4 mi',
    image: '',
    images: [
      '',
      '',
      '',
      '',
    ],
    category: 'tools', shipping: true, shippingCost: 0, pickup: true, timeAgo: '2h', views: 47,
    description: 'Milwaukee M18 FUEL 1/2" Drill/Driver Kit in excellent condition. Includes case, batteries, charger, and bits.',
    seller: sellers.s1, offerOk: true,
  },
  {
    id: '2', title: 'Snap-on 1/2" Drive Impact Wrench', price: 340, condition: 'Good',
    brand: 'Snap-on', location: 'Denver, CO', distance: '3.2 mi',
    image: '',
    images: [
      '',
      '',
    ],
    category: 'auto', shipping: true, shippingCost: 18, pickup: false, timeAgo: '5h', views: 83,
    description: 'Professional-grade Snap-on impact wrench with excellent torque and minor cosmetic wear.',
    seller: sellers.s2, offerOk: true,
  },
  {
    id: '3', title: 'Husqvarna 450 Rancher Chainsaw 20"', price: 295, condition: 'Good',
    brand: 'Husqvarna', location: 'Portland, OR', distance: '8.1 mi',
    image: '',
    images: [
      '',
      '',
    ],
    category: 'outdoor', shipping: false, shippingCost: 0, pickup: true, timeAgo: '1d', views: 124,
    description: 'Husqvarna 450 Rancher with 20" bar, fresh oil change, and a new chain.',
    seller: sellers.s3, offerOk: false,
  },
  {
    id: '4', title: 'DeWalt DWS779 12" Sliding Miter Saw', price: 265, condition: 'Like New',
    brand: 'DeWalt', location: 'Chicago, IL', distance: '12.5 mi',
    image: '',
    images: [
      '',
      '',
    ],
    category: 'tools', shipping: true, shippingCost: 35, pickup: true, timeAgo: '3h', views: 56,
    description: 'DeWalt compound miter saw used twice, including stand adapter and dust bag.',
    seller: sellers.s4, offerOk: true,
  },
  {
    id: '5', title: 'Warn 9.5cti Winch — Never Used', price: 580, condition: 'New',
    brand: 'Warn', location: 'Phoenix, AZ', distance: '18.4 mi',
    image: '',
    images: [''],
    category: 'auto', shipping: true, shippingCost: 0, pickup: true, timeAgo: '6h', views: 91,
    description: 'Warn 9.5cti winch in the original box with transferable factory warranty.',
    seller: sellers.s3, offerOk: true,
  },
  {
    id: '6', title: 'Lincoln Electric 210 MP Welder', price: 475, condition: 'Good',
    brand: 'Lincoln Electric', location: 'Houston, TX', distance: '5.3 mi',
    image: '',
    images: [
      '',
      '',
    ],
    category: 'shop', shipping: false, shippingCost: 0, pickup: true, timeAgo: '12h', views: 203,
    description: 'Multi-process welder for MIG, flux-core, TIG-ready, and stick welding.',
    seller: sellers.s5, offerOk: false,
  },
  {
    id: '7', title: 'Makita 18V LXT 6-Tool Combo Kit', price: 398, condition: 'Like New',
    brand: 'Makita', location: 'Seattle, WA', distance: '4.7 mi',
    image: '',
    images: [
      '',
      '',
    ],
    category: 'tools', shipping: true, shippingCost: 0, pickup: true, timeAgo: '8h', views: 167,
    description: 'Makita 18V LXT six-piece combo with batteries, charger, and kit bag.',
    seller: sellers.s4, offerOk: true,
  },
  {
    id: '8', title: 'Garmin ECHOMAP UHD2 94sv Fish Finder', price: 695, condition: 'New',
    brand: 'Garmin', location: 'Tampa, FL', distance: '22.1 mi',
    image: '',
    images: [''],
    category: 'marine', shipping: true, shippingCost: 0, pickup: false, timeAgo: '4h', views: 38,
    description: 'Brand-new Garmin fish finder with transducer and full warranty.',
    seller: sellers.s2, offerOk: false,
  },
];
