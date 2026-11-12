import { createPublicClient, createWalletClient, defineChain, getAddress, http, parseUnits, zeroAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { compileContracts } from './compile.mjs';

const testnets = new Set([11155111, 84532, 421614, 11155420, 80002, 43113]);
const localChains = new Set([1337, 31337]);
const chainId = Number(process.env.STOCKPACT_TESTNET_CHAIN_ID ?? 84532);
const rpc = new URL(process.env.STOCKPACT_TESTNET_RPC_URL ?? '');
const local = localChains.has(chainId) && ['127.0.0.1', '[::1]', 'localhost'].includes(rpc.hostname);
if ((!local && (!testnets.has(chainId) || rpc.protocol !== 'https:')) || (local && rpc.protocol !== 'http:')) {
  throw new Error('Deployment requires a supported EVM testnet via HTTPS or a local chain on the loopback interface.');
}

function requiredAddress(name) {
  const address = getAddress(process.env[name] ?? '');
  if (address === zeroAddress) throw new Error(`${name} must be a nonzero address.`);
  return address;
}

const account = privateKeyToAccount(process.env.STOCKPACT_TESTNET_DEPLOYER_KEY ?? '');
const attestor = requiredAddress('STOCKPACT_TESTNET_ATTESTOR_ADDRESS');
const resolver = requiredAddress('STOCKPACT_TESTNET_RESOLVER_ADDRESS');
const recipient = requiredAddress('STOCKPACT_TESTNET_TOKEN_RECIPIENT');
const supply = parseUnits(process.env.STOCKPACT_TESTNET_TOKEN_SUPPLY ?? '100000', 6);
if (supply <= 0n) throw new Error('Test token supply must be positive.');

const chain = defineChain({
  id: chainId,
  name: 'StockPact test chain',
  nativeCurrency: { name: 'Testnet gas', symbol: 'GAS', decimals: 18 },
  rpcUrls: { default: { http: [rpc.href] } },
  testnet: true,
});
const publicClient = createPublicClient({ chain, transport: http() });
const wallet = createWalletClient({ account, chain, transport: http() });
if (await publicClient.getChainId() !== chainId) throw new Error('RPC chain differs from the configured chain ID.');
const { TestStock, StockPactEscrow } = compileContracts();

async function deploy(contract, args) {
  const hash = await wallet.deployContract({ ...contract, args });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`Deployment failed in transaction ${hash}.`);
  return { address: receipt.contractAddress, hash };
}

const token = await deploy(TestStock, [recipient, supply]);
console.log(`STOCKPACT_TESTNET_TOKEN_ADDRESS=${token.address}`);
console.log(`Token deployment transaction ${token.hash}`);
const escrow = await deploy(StockPactEscrow, [token.address, attestor, resolver]);
console.log(`STOCKPACT_TESTNET_ESCROW_ADDRESS=${escrow.address}`);
console.log(`Escrow deployment transaction ${escrow.hash}`);
console.log(`Chain ${chainId} · ${local ? 'local' : 'testnet'} · TSTK · 6 decimals`);
