import { expect, test } from '@playwright/test';
import type { MarketplaceState, Order } from '../../src/shared/marketplace';
import type { XrplAttempt } from '../../src/shared/xrpl';

const createdAt = '2026-11-13T09:00:00Z';
const order: Order = {
  id: 'xrpl-order', reference: 'SP-XRPL', quoteId: 'quote', requestId: 'request', buyerId: 'buyer', supplierId: 'supplier',
  product: 'Chopped tomatoes', unit: 'cases', quantity: 20, acceptedQuantity: 20, unitPriceCents: 21_500, totalCents: 445_000,
  taxCents: 0, deliveryFeeCents: 15_000, deliveryDate: '2026-11-13', location: 'Woodstock, Cape Town', status: 'completed',
  paymentMode: 'xrpl', fundedCents: 0, releasedCents: 0, refundedCents: 0, transactions: [], messages: [], timeline: [], createdAt,
};
const recipient = 'rEXAMPLE';
const validatedHash = 'A'.repeat(64);
const blocked: XrplAttempt = { id: 'second-attempt', orderId: order.id, sourceId: 'second-handover', mandateId: 'mandate',
  recipient, drops: '1780000', status: 'blocked', reason: 'The accepted handover exceeds the remaining total mandate cap.', createdAt, updatedAt: createdAt };

function stateFor(companyId: 'buyer' | 'supplier', attempt: XrplAttempt): MarketplaceState {
  return {
    actor: { id: companyId, name: companyId, email: `${companyId}@example.test`, companyId, role: 'owner', demoRole: companyId, memberships: [] },
    demo: true, aiMode: 'demo', escrow: { mode: 'demo' }, roles: [], companies: [], listings: [], requests: [], quotes: [], orders: [order],
    notifications: [], favorites: [], preferredSuppliers: [], reviews: [], disputes: [], shoppingLists: [], team: [],
    xrpl: { enabled: true, configured: true, mode: 'testnet', recipient, dropsPerZarCent: 10, mandates: [], attempts: [
      { ...blocked, id: 'first-attempt', sourceId: 'first-handover', drops: '2670000', status: 'confirmed', reason: undefined,
        hash: validatedHash, ledgerIndex: 1_000 }, attempt,
    ] },
  };
}

test('XRPL order distinguishes delivery, validation, and buyer-only recovery', async ({ page }) => {
  let actor: 'buyer' | 'supplier' = 'buyer';
  let attempt = blocked;
  const actions: { action: string; attemptId: string }[] = [];
  await page.route('**/api/state', (route) => route.fulfill({ json: stateFor(actor, attempt) }));
  await page.route('**/api/attachments?*', (route) => route.fulfill({ json: { attachments: [] } }));
  await page.route('**/api/actions', async (route) => {
    const input = route.request().postDataJSON();
    actions.push(input);
    if (input.action === 'requeueXrplPayment') attempt = { ...blocked, status: 'queued', reason: 'Buyer requested a fresh payment decision.' };
    await route.fulfill({ json: { data: { xrplAttemptId: blocked.id }, state: stateFor(actor, attempt) } });
  });

  await page.goto(`/#orders/${order.id}`);
  await expect(page.getByRole('heading', { name: 'Testnet payment status' })).toBeVisible();
  await expect(page.getByText('Delivery complete').first()).toBeVisible();
  await expect(page.getByText('Payment action needed').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'View Testnet receipt' })).toHaveAttribute('href', `https://testnet.xrpl.org/transactions/${validatedHash}`);
  await expect(page.getByRole('button', { name: 'Review mandate' })).toBeVisible();
  await page.getByRole('button', { name: 'Request payment again' }).click();
  await expect(page.getByText('Payment pending').first()).toBeVisible();
  expect(actions).toEqual([{ action: 'requeueXrplPayment', attemptId: blocked.id }]);

  actor = 'supplier';
  attempt = blocked;
  await page.reload();
  await expect(page.getByText('Ask the buyer to review the supplier mandate and request another payment decision.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request payment again' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review mandate' })).toHaveCount(0);
});
