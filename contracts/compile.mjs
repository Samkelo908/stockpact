import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

const names = ['TestStock', 'StockPactEscrow'];
const require = createRequire(import.meta.url);

export function compileContracts() {
  const sources = Object.fromEntries(names.map((name) => {
    const filename = `${name}.sol`;
    return [filename, { content: readFileSync(new URL(filename, import.meta.url), 'utf8') }];
  }));
  const input = {
    language: 'Solidity',
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'cancun',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input), {
    import(path) {
      try {
        return { contents: readFileSync(require.resolve(path), 'utf8') };
      } catch {
        return { error: `Unable to read Solidity import ${path}` };
      }
    },
  }));
  const errors = output.errors?.filter((entry) => entry.severity === 'error') ?? [];
  if (errors.length) throw new Error(errors.map((entry) => entry.formattedMessage).join('\n'));
  return Object.fromEntries(names.map((name) => {
    const contract = output.contracts[`${name}.sol`][name];
    return [name, { abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` }];
  }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outputDirectory = new URL('artifacts/', import.meta.url);
  mkdirSync(outputDirectory, { recursive: true });
  for (const [name, artifact] of Object.entries(compileContracts())) {
    writeFileSync(new URL(`${name}.json`, outputDirectory), `${JSON.stringify(artifact, null, 2)}\n`);
  }
  console.log('Compiled StockPact escrow and its test token.');
}
