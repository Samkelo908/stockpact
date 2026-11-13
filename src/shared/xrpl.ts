export const xrplTestDropsPerZarCent = 10;

export interface XrplMandate {
  id: string;
  supplierId: string;
  recipient: string;
  destinationTag?: number;
  maxDrops: string;
  totalDrops: string;
  usedDrops: string;
  reservedDrops: string;
  paused: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface XrplAttempt {
  id: string;
  orderId: string;
  sourceId: string;
  mandateId: string;
  recipient: string;
  destinationTag?: number;
  drops: string;
  status: 'queued' | 'processing' | 'pending' | 'confirmed' | 'failed' | 'expired' | 'blocked';
  hash?: string;
  ledgerIndex?: number;
  reason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface XrplState {
  enabled: boolean;
  mode: 'disabled' | 'testnet';
  configured: boolean;
  account?: string;
  explorerUrl?: string;
  recipient?: string;
  supplierId?: string;
  destinationTag?: number;
  maxPaymentDrops?: string;
  dropsPerZarCent: number;
  mandates: XrplMandate[];
  attempts: XrplAttempt[];
}
