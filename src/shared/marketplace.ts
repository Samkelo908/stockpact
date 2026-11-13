import type { EscrowStatus } from '../integrations/escrow/shared';

export const initialMarket = { country: 'ZA', currency: 'ZAR' } as const;

export const demoRoles = ['buyer', 'supplier', 'supplier2', 'driver', 'admin'] as const;
export type DemoRole = (typeof demoRoles)[number];
export type CompanyRole = 'owner' | 'purchaser' | 'approver' | 'sales' | 'driver' | 'reviewer';
export type VerificationStatus = 'unsubmitted' | 'pending' | 'action_required' | 'verified' | 'rejected' | 'expired';
export type Capability = 'buyer' | 'supplier' | 'delivery';
export type VerificationScope = 'business' | 'representative' | 'delivery';

export interface VerificationCheck {
  id: string;
  companyId: string;
  scope: VerificationScope;
  status: Exclude<VerificationStatus, 'unsubmitted'>;
  provider: string;
  providerReference?: string | null;
  note: string;
  createdAt: string;
}

export interface Actor {
  id: string;
  name: string;
  email: string;
  companyId: string;
  role: CompanyRole;
  demoRole?: DemoRole;
  memberships: { companyId: string; companyName: string; role: CompanyRole }[];
}

export interface Company {
  id: string;
  name: string;
  legalName: string;
  country: string;
  currency: string;
  location: string;
  registrationNumber?: string;
  contact?: string;
  representative?: string;
  capabilities: Capability[];
  verification: { business: VerificationStatus; representative: VerificationStatus; delivery: VerificationStatus };
  verificationReviewIds?: Partial<Record<VerificationScope, string>>;
  verificationNote?: string;
  approvalThresholdCents?: number | null;
  demo: boolean;
  wallet?: `0x${string}`;
}

export interface Listing {
  id: string;
  supplierId: string;
  name: string;
  category: string;
  description: string;
  unit: string;
  priceCents: number | null;
  available: number;
  minimum: number;
  packSize: number;
  deliveryAreas: string[];
  leadDays: number;
  deliveryFeeCents: number;
  collection: boolean;
  archived: boolean;
  updatedAt: string;
  demo: boolean;
  brand?: string;
  image?: string;
  surplus?: boolean;
}

export interface RequestDraft {
  product: string;
  quantity: number;
  unit: string;
  location: string;
  requiredDate: string;
  budgetCents: number | null;
  notes: string;
  category: string;
  substitutions: boolean;
  collection?: boolean;
  packSize?: number;
  shareBudget?: boolean;
  missing?: string[];
  mode: 'cloudflare' | 'demo' | 'manual';
}

export interface Match {
  supplierId: string;
  listingId: string;
  score: number;
  reasons: string[];
}

export interface SupplierResponse {
  supplierId: string;
  status: 'sent' | 'declined' | 'quoted';
  note?: string;
  activity?: { title: string; at: string }[];
}

export interface PurchaseRequest {
  id: string;
  buyerId: string;
  draft: RequestDraft;
  status: 'draft' | 'matching' | 'matched' | 'sent' | 'accepted' | 'expired';
  createdAt: string;
  matchedAt?: string;
  matches: Match[];
  supplierIds: string[];
  supplierResponses?: SupplierResponse[];
  activity: { title: string; at: string }[];
}

export interface Quote {
  id: string;
  requestId: string;
  supplierId: string;
  listingId: string;
  product?: string;
  unit?: string;
  packSize?: number;
  specification?: string;
  substitution?: boolean;
  version: number;
  quantity: number;
  unitPriceCents: number;
  taxCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  currency: string;
  deliveryDate: string;
  expiresAt: string;
  notes: string;
  status: 'submitted' | 'superseded' | 'accepted' | 'declined';
  createdAt: string;
}

export interface OrderMessage {
  id: string;
  authorId: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface OrderTransaction {
  id: string;
  kind: 'funding' | 'release' | 'refund';
  status: 'pending' | 'failed' | 'confirmed';
  mode: 'demo' | 'testnet';
  amountCents: number;
  quantity?: number;
  hash?: `0x${string}`;
  createdAt: string;
}

export interface Order {
  id: string;
  reference: string;
  quoteId: string;
  requestId: string;
  buyerId: string;
  supplierId: string;
  driverId?: string;
  product: string;
  unit: string;
  packSize?: number;
  specification?: string;
  currency?: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  taxCents: number;
  deliveryFeeCents: number;
  deliveryDate: string;
  location: string;
  status: 'approval' | 'awaiting_funding' | 'funded' | 'dispatched' | 'partial' | 'completed' | 'cancelled' | 'disputed';
  paymentMode?: 'demo' | 'testnet';
  fundedCents: number;
  releasedCents: number;
  refundedCents: number;
  refundedQuantity?: number;
  acceptedQuantity: number;
  transactions: OrderTransaction[];
  messages: OrderMessage[];
  timeline: { title: string; at: string }[];
  createdAt: string;
  reviewId?: string;
  activeAuthorization?: { quantity: number; amountCents: number; expiresAt: string };
}

export interface Notice {
  id: string;
  title: string;
  body: string;
  href: string;
  read: boolean;
  createdAt: string;
}

export interface Review {
  id: string;
  orderId: string;
  supplierId: string;
  buyerId: string;
  rating: number;
  quality: number;
  reliability: number;
  accuracy: number;
  communication: number;
  comment: string;
  createdAt: string;
  demo: boolean;
}

export interface Dispute {
  id: string;
  orderId: string;
  openedBy: string;
  quantity: number;
  reason: string;
  amountCents: number;
  status: 'open' | 'resolved';
  resolution?: string;
  createdAt: string;
}

export interface ShoppingList {
  id: string;
  name: string;
  items: RequestDraft[];
  remindAt?: string;
}

export interface MarketplaceState {
  actor: Actor | null;
  demo: boolean;
  aiMode: 'cloudflare' | 'demo';
  escrow: EscrowStatus;
  roles: { role: DemoRole; label: string; name: string }[];
  companies: Company[];
  listings: Listing[];
  requests: PurchaseRequest[];
  quotes: Quote[];
  orders: Order[];
  notifications: Notice[];
  favorites: string[];
  preferredSuppliers: string[];
  reviews: Review[];
  disputes: Dispute[];
  shoppingLists: ShoppingList[];
  team: { id: string; name: string; email: string; role: CompanyRole }[];
  verificationHistory?: VerificationCheck[];
  verificationProvider?: { sandbox: boolean; scopes: VerificationScope[] };
}

export interface DeliveryAuthorization {
  token: string;
  orderId: string;
  quantity: number;
  amountCents: number;
  expiresAt: string;
  status: 'active' | 'redeemed' | 'expired' | 'cancelled';
}
