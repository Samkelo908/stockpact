'use client';

import { useState } from 'react';
import { CircleAlert, ExternalLink, QrCode, Wallet } from 'lucide-react';
import { formatUnits, type Hex } from 'viem';
import type { RunAction } from '../../components/client';
import { Busy, PanelTitle } from '../../components/ui';
import type { DeliveryAuthorization, MarketplaceState, Order } from '../../shared/marketplace';
import { connectWallet, fundEscrow, releaseEscrow, signRelease, signWalletProof } from './browser';
import { deliveryAmountCents, toTokenUnits, type EscrowAuthorization, type EscrowConfiguration, type FundingTerms, type WalletProof } from './shared';

type ControlProps = { state: MarketplaceState; run: RunAction; busy: string | boolean };
type DraftRelease = DeliveryAuthorization & { authorization: EscrowAuthorization; platformSignature: Hex; buyerWallet: string };

export type TestnetDeliveryInspection = DeliveryAuthorization & {
  authorization?: EscrowAuthorization;
  buyerSignature?: Hex;
  platformSignature?: Hex;
  supplierWallet?: string;
  driverWallet?: string;
  transactionHash?: Hex;
};

function useWalletTask() {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  async function execute(action: () => Promise<void>) {
    if (working) return;
    setWorking(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      const shortMessage = typeof cause === 'object' && cause && 'shortMessage' in cause && typeof cause.shortMessage === 'string' ? cause.shortMessage : '';
      setError(shortMessage || (cause instanceof Error ? cause.message : 'The wallet request failed. Try again.'));
    } finally {
      setWorking(false);
    }
  }
  return { working, error, execute };
}

function ErrorNotice({ error }: { error: string }) {
  return error ? <div className="notice notice-error" role="alert"><CircleAlert size={16} />{error}</div> : null;
}

function paymentLabel(config: EscrowConfiguration, amountCents: number) {
  return `${formatUnits(toTokenUnits(amountCents, config.tokenDecimals), config.tokenDecimals)} ${config.tokenSymbol}`;
}

export function WalletRegistration({ state, run, busy }: ControlProps) {
  const task = useWalletTask();
  const config = state.escrow;
  if (config.mode !== 'testnet' || !state.actor) return null;
  const chain = config;
  const registered = state.companies.find(({ id }) => id === state.actor?.companyId)?.wallet;

  async function register() {
    const address = await connectWallet(chain);
    const result = await run<WalletProof>('walletChallenge', { address });
    if (!result?.data) return;
    const signature = await signWalletProof(chain, result.data);
    await run('setWallet', { challenge: result.data.challenge, signature }, 'Testnet wallet registered.');
  }

  return <section className="card panel small-stack">
    <PanelTitle title="Testnet wallet" subtitle={`${config.networkName} · ${config.tokenSymbol}`} />
    {registered ? <p className="small-note break-all">{registered}</p> : <p className="small-note">Register a company wallet to fund or accept testnet payments.</p>}
    {state.actor.role === 'owner' && <div className="button-row"><button type="button" className="secondary" disabled={!!busy || task.working} onClick={() => void task.execute(register)}><Wallet size={16} />{registered ? 'Update wallet' : 'Register wallet'}</button></div>}
    {task.working && <Busy label="Waiting for wallet approval" />}
    <ErrorNotice error={task.error} />
  </section>;
}

function readStoredHash(key: string) {
  try { return window.localStorage.getItem(key) ?? ''; } catch { return ''; }
}

function saveHash(key: string, hash: string) {
  try {
    if (hash) window.localStorage.setItem(key, hash);
    else window.localStorage.removeItem(key);
  } catch {
    // Confirmation can still proceed in this tab when browser storage is blocked.
  }
}

function TestnetTransaction({ config, scope, busy, label, detail, knownHash, submit, verify }: {
  config: EscrowConfiguration;
  scope: string;
  busy: string | boolean;
  label: string;
  detail: string;
  knownHash?: Hex;
  submit: () => Promise<Hex | undefined>;
  verify: (hash: string) => Promise<boolean>;
}) {
  const storageKey = `stockpact-escrow-${config.chainId}-${config.contract}-${scope}`;
  const [hash, setHash] = useState(() => knownHash ?? readStoredHash(storageKey));
  const [recovery, setRecovery] = useState(() => Boolean(hash));
  const task = useWalletTask();

  function updateHash(value: string) {
    setHash(value);
    saveHash(storageKey, value);
  }

  async function confirm(value: string) {
    if (!/^0x[0-9a-f]{64}$/i.test(value)) throw new Error('Enter the 32-byte transaction hash from your wallet.');
    if (await verify(value)) updateHash('');
  }

  async function send() {
    const submitted = await submit();
    if (!submitted) return;
    updateHash(submitted);
    setRecovery(true);
    await confirm(submitted);
  }

  return <div className="small-stack">
    <p className="small-note">{detail}</p>
    {recovery ? <div className="small-stack">
      <label className="field">Testnet transaction hash<input spellCheck={false} autoCapitalize="none" autoComplete="off" maxLength={66} value={hash} onChange={(event) => updateHash(event.currentTarget.value.trim())} placeholder="0x…" /></label>
      <div className="button-row">
        <button type="button" className="primary" disabled={!!busy || task.working || !hash} onClick={() => void task.execute(() => confirm(hash))}>Check confirmation</button>
        {/^0x[0-9a-f]{64}$/i.test(hash) && <a className="secondary" href={`${config.explorerUrl}/tx/${hash}`} target="_blank" rel="noreferrer">View transaction <ExternalLink size={14} /></a>}
        <button type="button" className="secondary" disabled={!!busy || task.working} onClick={() => setRecovery(false)}>Back to wallet</button>
      </div>
    </div> : <div className="button-row">
      <button type="button" className="primary" disabled={!!busy || task.working} onClick={() => void task.execute(send)}><Wallet size={16} />{label}</button>
      <button type="button" className="secondary" disabled={!!busy || task.working} onClick={() => setRecovery(true)}>Recover transaction</button>
    </div>}
    {task.working && <Busy label={recovery ? 'Checking testnet receipt' : 'Waiting for wallet approval'} />}
    <ErrorNotice error={task.error} />
  </div>;
}

export function OrderFunding({ state, order, run, busy }: ControlProps & { order: Order }) {
  const config = state.escrow;
  if (config.mode !== 'testnet') return null;
  const chain = config;
  return <TestnetTransaction key={order.id} config={chain} scope={`fund-${order.id}`} busy={busy}
    label={`Fund ${paymentLabel(chain, order.totalCents)}`}
    detail={`Reserve ${paymentLabel(chain, order.totalCents)} on ${chain.networkName}. Your wallet shows the test gas fee.`}
    submit={async () => {
      const prepared = await run<FundingTerms>('prepareFunding', { orderId: order.id });
      if (prepared?.data) return fundEscrow(chain, prepared.data);
    }}
    verify={async (hash) => Boolean(await run('fundOrder', { orderId: order.id, transactionHash: hash }, 'Testnet funding confirmed.'))} />;
}

export function AuthorizeTestnetDelivery({ state, order, quantity, run, busy, onAuthorized }: ControlProps & {
  order: Order;
  quantity: number;
  onAuthorized: (data: DeliveryAuthorization) => void;
}) {
  const [draft, setDraft] = useState<DraftRelease | null>(null);
  const task = useWalletTask();
  const config = state.escrow;
  if (config.mode !== 'testnet') return null;
  const chain = config;
  const valid = Number.isSafeInteger(quantity) && quantity > 0 && quantity <= order.quantity - order.acceptedQuantity;

  async function authorize() {
    const staged = draft && draft.quantity === quantity && new Date(draft.expiresAt).getTime() > Date.now()
      ? draft
      : (await run<DraftRelease>('authorizeDelivery', { orderId: order.id, quantity }))?.data;
    if (!staged) return;
    setDraft({ ...staged, quantity });
    const buyerWallet = staged.buyerWallet || state.companies.find(({ id }) => id === order.buyerId)?.wallet;
    if (!buyerWallet) throw new Error('The buyer wallet is unavailable for this authorization.');
    const signature = await signRelease(chain, { authorization: staged.authorization, buyerWallet });
    const result = await run('signDelivery', { token: staged.token, signature }, 'Delivery authorization signed.');
    if (result) onAuthorized({ ...staged, quantity, orderId: order.id, status: 'active' });
  }

  return <div className="small-stack">
    {valid && <p className="small-note">Authorize {paymentLabel(chain, deliveryAmountCents(order.totalCents, order.quantity, order.acceptedQuantity, quantity))} on {chain.networkName}.</p>}
    <div className="button-row"><button type="button" className="primary" disabled={!valid || !!busy || task.working} onClick={() => void task.execute(authorize)}><QrCode size={16} />Sign and generate QR</button></div>
    {task.working && <Busy label="Waiting for buyer signature" />}
    <ErrorNotice error={task.error} />
  </div>;
}

export function RedeemTestnetDelivery({ state, inspection, token, run, busy, onRedeemed }: ControlProps & {
  inspection: TestnetDeliveryInspection;
  token: string;
  onRedeemed?: () => void;
}) {
  const config = state.escrow;
  const { authorization, buyerSignature, platformSignature, supplierWallet, driverWallet } = inspection;
  if (config.mode !== 'testnet' || !authorization || !buyerSignature || !platformSignature) return null;
  const chain = config;
  const amount = `${formatUnits(BigInt(authorization.amount), chain.tokenDecimals)} ${chain.tokenSymbol}`;
  return <TestnetTransaction key={authorization.nonce} config={chain} scope={`release-${authorization.nonce}`} busy={busy}
    label={`Accept and release ${amount}`}
    detail={`Release ${amount} on ${chain.networkName} to the order supplier. Your wallet shows the test gas fee.`}
    knownHash={inspection.transactionHash}
    submit={() => {
      if (new Date(inspection.expiresAt).getTime() <= Date.now()) throw new Error('This code has expired. Recover a transaction you already submitted or ask for a new code.');
      return releaseEscrow(chain, { authorization, buyerSignature, platformSignature, supplierWallet: supplierWallet ?? authorization.supplier, driverWallet });
    }}
    verify={async (hash) => {
      const result = await run('redeemDelivery', { token, transactionHash: hash }, 'Testnet release confirmed.');
      if (result) onRedeemed?.();
      return Boolean(result);
    }} />;
}
