import { createPublicClient, createWalletClient, custom, defineChain, erc20Abi, type Address, type Hex } from 'viem';
import {
  escrowAbi,
  escrowOrderReference,
  orderKey,
  positiveInteger,
  releaseMessage,
  releaseTypedData,
  toTokenUnits,
  walletAddress,
  walletProofMessage,
  type EscrowAuthorization,
  type EscrowConfiguration,
  type FundingTerms,
  type WalletProof,
} from './shared';

function walletClients(config: EscrowConfiguration) {
  const provider = typeof window === 'undefined' ? undefined : (window as Window & { ethereum?: Parameters<typeof custom>[0] }).ethereum;
  if (!provider) throw new Error('Open StockPact in a browser with an EVM testnet wallet.');
  const chain = defineChain({
    id: config.chainId,
    name: config.networkName,
    nativeCurrency: { name: 'Testnet gas', symbol: 'GAS', decimals: 18 },
    rpcUrls: { default: { http: [] } },
    testnet: true,
  });
  const transport = custom(provider);
  return { chain, wallet: createWalletClient({ chain, transport }), client: createPublicClient({ chain, transport }) };
}

export async function connectWallet(config: EscrowConfiguration): Promise<Address> {
  const { wallet } = walletClients(config);
  const [address] = await wallet.requestAddresses();
  if (!address) throw new Error('Choose an account in your testnet wallet.');
  if (await wallet.getChainId() !== config.chainId) {
    try {
      await wallet.switchChain({ id: config.chainId });
    } catch (cause) {
      throw new Error(`Switch your wallet to ${config.networkName} to continue.`, { cause });
    }
  }
  return walletAddress(address);
}

async function requireWallet(config: EscrowConfiguration, expectedAddress: string) {
  const address = await connectWallet(config);
  if (address !== walletAddress(expectedAddress)) throw new Error('Choose the wallet registered to this company.');
  return address;
}

export async function signWalletProof(config: EscrowConfiguration, proof: WalletProof): Promise<Hex> {
  const account = await requireWallet(config, proof.address);
  return walletClients(config).wallet.signMessage({ account, message: walletProofMessage(config, proof) });
}

export async function fundEscrow(config: EscrowConfiguration, terms: FundingTerms): Promise<Hex> {
  const account = await requireWallet(config, terms.buyerWallet);
  const { wallet, client } = walletClients(config);
  const supplier = walletAddress(terms.supplierWallet);
  const quantity = positiveInteger(terms.quantity, 'Order quantity');
  const amount = toTokenUnits(terms.amountCents, config.tokenDecimals);
  const allowance = await client.readContract({
    address: config.token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [account, config.contract],
  });
  if (allowance < amount) {
    const approval = await wallet.writeContract({
      account,
      address: config.token,
      abi: erc20Abi,
      functionName: 'approve',
      args: [config.contract, amount],
    });
    const receipt = await client.waitForTransactionReceipt({ hash: approval });
    if (receipt.status !== 'success') throw new Error('Token approval failed.');
  }
  const { request } = await client.simulateContract({
    account,
    address: config.contract,
    abi: escrowAbi,
    functionName: 'fund',
    args: [orderKey(terms.orderId), supplier, quantity, amount],
  });
  return wallet.writeContract(request);
}

export async function signRelease(config: EscrowConfiguration, input: { authorization: EscrowAuthorization; buyerWallet: string }): Promise<Hex> {
  const account = await requireWallet(config, input.buyerWallet);
  return walletClients(config).wallet.signTypedData({ account, ...releaseTypedData(config, input.authorization) });
}

export async function revokeEscrowAuthorization(config: EscrowConfiguration, input: { authorization: EscrowAuthorization; buyerWallet: string }) {
  const account = await requireWallet(config, input.buyerWallet);
  const { wallet, client } = walletClients(config);
  const { authorization } = input;
  const contract = { address: config.contract, abi: escrowAbi };
  const args = [authorization.orderId, authorization.nonce] as const;
  if (await client.readContract({ ...contract, functionName: 'unavailableNonces', args })) return;
  const { request } = await client.simulateContract({ ...contract, account, functionName: 'cancelAuthorization', args });
  const hash = await wallet.writeContract(request);
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: config.confirmations, timeout: 30_000 });
  if (receipt.status !== 'success') throw new Error('The wallet transaction did not revoke this handover code.');
}

export async function releaseEscrow(config: EscrowConfiguration, input: {
  authorization: EscrowAuthorization;
  buyerSignature: Hex;
  platformSignature: Hex;
  supplierWallet: string;
  driverWallet?: string;
}): Promise<Hex> {
  const account = await requireWallet(config, input.driverWallet ?? input.supplierWallet);
  const { wallet, client } = walletClients(config);
  const { request } = await client.simulateContract({
    account,
    address: config.contract,
    abi: escrowAbi,
    functionName: 'release',
    args: [releaseMessage(input.authorization), input.buyerSignature, input.platformSignature],
  });
  return wallet.writeContract(request);
}

export async function assignEscrowDriver(config: EscrowConfiguration, input: {
  orderId: string;
  buyerWallet: string;
  supplierWallet: string;
  driverWallet: string;
}): Promise<Hex> {
  const account = await requireWallet(config, input.supplierWallet);
  const { wallet, client } = walletClients(config);
  const { request } = await client.simulateContract({
    account,
    address: config.contract,
    abi: escrowAbi,
    functionName: 'setDriver',
    args: [escrowOrderReference(input.orderId, input.buyerWallet), walletAddress(input.driverWallet)],
  });
  return wallet.writeContract(request);
}
