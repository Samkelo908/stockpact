import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import {
  confirmXrplPayment, prepareXrplPayment, submitXrplPayment, type SignedXrplPayment, type XrplPaymentResult,
} from '../integrations/xrpl/server';
import type { XrplAttempt } from '../shared/xrpl';
import { MarketplaceError, notify } from './access';
import { getDb, mutate, type DbSession } from './db';
import {
  attemptColumns, auditXrpl, paymentEvidence, publicAttempt, verifyXrplEvidence, verifyXrplIntent, type AttemptRow, type XrplDecisionProvider,
} from './xrpl-policy';

export { ensureXrplOrderMandate, getXrplState, pauseXrplMandate, stageXrplIntent, upsertXrplMandate } from './xrpl-policy';
export type { XrplDecisionProvider, XrplEvidence } from './xrpl-policy';

type Job = AttemptRow & { agent_approved: boolean | null; hold_drops: string; signer_account: string | null;
  signed: SignedXrplPayment | null; submitted_at: Date | string | null; lease_id: string | null };
type JobFilter = { attemptId?: string; companyId?: string };
type Policy = Awaited<ReturnType<typeof verifyXrplIntent>>;
const jobColumns = sql`${attemptColumns}, agent_approved, hold_drops::text as hold_drops, signer_account, signed, submitted_at, lease_id`;
const terminal = (status: XrplAttempt['status']) => ['confirmed', 'failed', 'expired', 'blocked'].includes(status);

async function getJob(db: DbSession, attemptId: string, filter: JobFilter = {}) {
  return (await sql<Job>`select ${jobColumns} from xrpl_payment_attempts where id = ${attemptId}
    ${filter.companyId ? sql`and buyer_id = ${filter.companyId}` : sql``}`.execute(db)).rows[0];
}

async function claimJob(filter: JobFilter) {
  return mutate(async (db) => {
    const candidates = await sql<Job>`select ${jobColumns} from xrpl_payment_attempts
      where status in ('queued','processing','pending') and next_attempt_at <= now() and (lease_until is null or lease_until <= now())
      ${filter.attemptId ? sql`and id = ${filter.attemptId}` : sql``}
      ${filter.companyId ? sql`and buyer_id = ${filter.companyId}` : sql``}
      order by case when submitted_at is not null then 0 when signer_account is not null then 1 else 2 end, created_at limit 1`.execute(db);
    const job = candidates.rows[0];
    if (!job) return null;
    const lease = randomUUID();
    await sql`update xrpl_payment_attempts set lease_id = ${lease}, lease_until = now() + interval '90 seconds',
      status = case when submitted_at is not null then 'pending' else 'processing' end, updated_at = now()
      where id = ${job.id}`.execute(db);
    return { ...job, status: job.submitted_at ? 'pending' as const : 'processing' as const, lease_id: lease };
  });
}

async function withLease<T>(job: Job, operation: (db: DbSession, current: Job) => Promise<T>) {
  return mutate(async (db) => {
    const current = await getJob(db, job.id);
    if (!current || current.lease_id !== job.lease_id || terminal(current.status)) return null;
    return operation(db, current);
  });
}

async function defer(db: DbSession, job: Job, seconds: number, reason: string) {
  const status = job.submitted_at ? 'pending' : job.signed || BigInt(job.hold_drops) > 0n ? 'processing' : 'queued';
  await sql`update xrpl_payment_attempts set status = ${status}, reason = ${reason},
    next_attempt_at = now() + ${seconds} * interval '1 second', lease_id = null, lease_until = null, updated_at = now()
    where id = ${job.id}`.execute(db);
}

async function finish(db: DbSession, job: Job, status: 'confirmed' | 'failed' | 'expired' | 'blocked', reason: string, ledgerIndex?: number) {
  if (BigInt(job.hold_drops) > 0n) {
    await sql`update xrpl_mandates set reserved_drops = reserved_drops - ${job.hold_drops}::bigint,
      used_drops = used_drops + ${status === 'confirmed' ? job.hold_drops : '0'}::bigint, updated_at = now()
      where id = ${job.mandate_id}`.execute(db);
  }
  await sql`update xrpl_payment_attempts set status = ${status}, reason = ${reason}, ledger_index = ${ledgerIndex ?? null}, hold_drops = 0,
    lease_id = null, lease_until = null, updated_at = now() where id = ${job.id}`.execute(db);
  await auditXrpl(db, job, `xrpl_payment_${status}`, reason);
  if (status === 'confirmed') {
    const detail = `A supplier payment of ${job.amount_drops} drops was validated on XRP Ledger Testnet.`;
    await notify(db, job.buyer_id, 'XRPL Testnet payment confirmed', detail, '#funds');
    await notify(db, job.supplier_id, 'XRPL Testnet payment confirmed', detail, '#funds');
  }
}

async function policyOrDefer(db: DbSession, job: Job): Promise<Policy | null> {
  try {
    const policy = await verifyXrplIntent(db, job);
    if (BigInt(policy.mandate.used_drops) + BigInt(policy.mandate.reserved_drops) - BigInt(job.hold_drops) + policy.amount > BigInt(policy.mandate.total_drops)) {
      throw new MarketplaceError('The accepted handover exceeds the remaining total mandate cap.', 409);
    }
    return policy;
  } catch (error) {
    if (!(error instanceof MarketplaceError)) throw error;
    if (error.status === 503) await defer(db, job, 60, error.message);
    else await finish(db, job, 'blocked', error.message);
    return null;
  }
}

async function requestAgentDecision(job: Job, decide: XrplDecisionProvider) {
  const eligible = await withLease(job, async (db, current) => {
    try {
      await verifyXrplEvidence(db, current);
      return true;
    } catch (error) {
      if (!(error instanceof MarketplaceError)) throw error;
      await finish(db, current, 'blocked', error.message);
      return false;
    }
  });
  if (!eligible) return false;
  let response: Awaited<ReturnType<XrplDecisionProvider>>;
  try {
    response = await decide(Object.freeze(paymentEvidence(job)));
    if (typeof response?.requestPayment !== 'boolean' || typeof response.reason !== 'string') throw new Error();
  } catch {
    await withLease(job, (db, current) => defer(db, current, 60, 'Waiting for the Cloudflare agent decision.'));
    return false;
  }
  return withLease(job, async (db, current) => {
    // No free-form model output is carried into signer instructions or exposed in the browser.
    const reason = response.requestPayment ? 'Cloudflare agent requested this exact handover payment.' : 'Cloudflare agent did not request payment.';
    await sql`update xrpl_payment_attempts set agent_approved = ${response.requestPayment}, agent_reason = ${reason} where id = ${current.id}`.execute(db);
    await auditXrpl(db, current, 'xrpl_agent_decision', reason);
    if (!response.requestPayment) await finish(db, current, 'blocked', reason);
    return response.requestPayment;
  });
}

async function reserveForSigner(job: Job) {
  return withLease(job, async (db, current) => {
    const policy = await policyOrDefer(db, current);
    if (!policy) return null;
    if (current.agent_approved !== true) throw new Error('XRPL signing requires a persisted agent decision.');
    if (current.signer_account && current.signer_account !== policy.config.account) {
      await finish(db, current, 'blocked', 'The deployment signer changed before submission.');
      return null;
    }
    const active = await sql`select id from xrpl_payment_attempts where signer_account = ${policy.config.account} and id <> ${current.id}
      and status in ('processing','pending') limit 1`.execute(db);
    if (active.rows.length) {
      await defer(db, current, 8, 'Waiting for the previous XRPL Testnet transaction to settle.');
      return null;
    }
    if (BigInt(current.hold_drops) === 0n) {
      await sql`update xrpl_mandates set reserved_drops = reserved_drops + ${current.amount_drops}::bigint,
        updated_at = now() where id = ${current.mandate_id}`.execute(db);
      await sql`update xrpl_payment_attempts set hold_drops = ${current.amount_drops}::bigint, signer_account = ${policy.config.account}
        where id = ${current.id}`.execute(db);
    }
    return { ...current, hold_drops: current.amount_drops, signer_account: policy.config.account };
  });
}

async function allowSubmission(job: Job, signed: SignedXrplPayment) {
  return withLease(job, async (db, current) => {
    const policy = await policyOrDefer(db, current);
    if (!policy) return null;
    if (current.agent_approved !== true || current.hold_drops !== current.amount_drops || current.signer_account !== policy.config.account ||
        signed.account !== policy.config.account || signed.destination !== current.recipient || signed.drops !== current.amount_drops ||
        signed.destinationTag !== (current.destination_tag ?? undefined)) {
      await finish(db, current, 'blocked', 'The prepared XRPL transaction did not match the approved mandate.');
      return null;
    }
    await sql`update xrpl_payment_attempts set signed = ${JSON.stringify(signed)}::jsonb, tx_hash = ${signed.hash},
      submitted_at = now(), status = 'pending', reason = 'Waiting for a validated XRPL Testnet ledger.', updated_at = now()
      where id = ${current.id}`.execute(db);
    await auditXrpl(db, current, 'xrpl_submission_authorized');
    return signed;
  });
}

async function recordOutcome(job: Job, result: XrplPaymentResult) {
  return withLease(job, async (db, current) => {
    if (!current.signed || result.hash !== current.signed.hash) throw new Error('XRPL result hash did not match persisted signed transaction.');
    if (result.status === 'confirmed') await finish(db, current, 'confirmed', 'Validated XRPL Testnet ledger confirmed this exact payment.', result.ledgerIndex);
    else if (result.status === 'failed') await finish(db, current, 'failed', 'The validated XRPL Testnet transaction failed.', result.ledgerIndex);
    else if (result.status === 'expired') await finish(db, current, 'expired', 'XRPL Testnet confirmed the signed transaction expired without settlement.', result.ledgerIndex);
    else await defer(db, current, 8, 'Waiting for a validated XRPL Testnet ledger.');
  });
}

async function submitSigned(job: Job, signed: SignedXrplPayment, previouslyAuthorized: boolean) {
  try {
    let result = previouslyAuthorized ? await confirmXrplPayment(signed) : null;
    if (previouslyAuthorized && result?.status === 'pending') {
      const resubmit = await withLease(job, async (db, current) => {
        try {
          const policy = await verifyXrplIntent(db, current);
          if (policy.config.account === signed.account) return true;
          throw new MarketplaceError('The deployment signer changed.', 409);
        } catch (error) {
          if (!(error instanceof MarketplaceError)) throw error;
          await defer(db, current, 15, 'Reconciling the signed transaction. Current policy prevents re-broadcast.');
          return false;
        }
      });
      if (!resubmit) return;
    }
    if (!result || result.status === 'pending') result = await submitXrplPayment(signed);
    await recordOutcome(job, result);
  } catch {
    await withLease(job, (db, current) => defer(db, current, 15, 'Waiting to reconcile the same signed XRPL Testnet transaction.'));
  }
}

async function processJob(job: Job, decide: XrplDecisionProvider) {
  if (job.submitted_at && job.signed) return submitSigned(job, job.signed, true);
  if (job.agent_approved !== true && !await requestAgentDecision(job, decide)) return;
  const reserved = await reserveForSigner(job);
  if (!reserved) return;
  let signed: SignedXrplPayment;
  try {
    signed = reserved.signed ?? await prepareXrplPayment({ intentId: reserved.id, orderId: reserved.order_id, recipient: reserved.recipient,
      drops: reserved.amount_drops, destinationTag: reserved.destination_tag ?? undefined, purpose: 'supplier_release' });
  } catch {
    await withLease(job, async (db, current) => {
      await sql`update xrpl_mandates set reserved_drops = reserved_drops - ${current.hold_drops}::bigint, updated_at = now()
        where id = ${current.mandate_id}`.execute(db);
      await sql`update xrpl_payment_attempts set hold_drops = 0, signer_account = null where id = ${current.id}`.execute(db);
      await defer(db, { ...current, hold_drops: '0' }, 30, 'Waiting for the XRPL Testnet signer.');
    });
    return;
  }
  const persisted = await allowSubmission(job, signed);
  if (persisted) await submitSigned(job, persisted, false);
}

export async function runXrplJobs(decide: XrplDecisionProvider, filter: JobFilter = {}): Promise<{ processed: number; attempt?: XrplAttempt }> {
  const job = await claimJob(filter);
  if (job) {
    try { await processJob(job, decide); }
    catch {
      console.error('StockPact XRPL job deferred.');
      await withLease(job, (db, current) => defer(db, current, 30, 'XRPL Testnet processing will retry.'));
    }
  }
  const target = job?.id ?? filter.attemptId;
  const latest = target ? await getJob(await getDb(), target, filter) : undefined;
  return { processed: job ? 1 : 0, attempt: latest ? publicAttempt(latest) : undefined };
}
