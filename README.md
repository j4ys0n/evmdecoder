# EvmDecoder

A library to fetch and decode smart contract related bytecode data from an EVM node.

EvmDecoder can determine if an address is a contract and (for supported types) return information about and/or properties of the contract. It can also decode transaction input data when provided with the respective (or matching) ABIs.

**All feature requests and contributions will be considered!**

## Contract Identification

EvmDecoder aims to identify common types of smart contracts by matching unique function signatures in the deployed bytecode of contracts. When a contract is identified as a type of proxy, the decoder will attempt to determine the contract address and type behind the proxy recusively and classify the final contract in the proxy chain.

Types of contracts that can be identified:

- Proxies: [ERC897](https://eips.ethereum.org/EIPS/eip-897), [ERC1822](https://eips.ethereum.org/EIPS/eip-1822), [ERC1967](https://eips.ethereum.org/EIPS/eip-1967)
- Proxy Clones: [ERC1167](https://eips.ethereum.org/EIPS/eip-1167), [ERC3448](https://eips.ethereum.org/EIPS/eip-3448), [Simple Multisig Clone](https://etherscan.io/address/0x5b9e8728e316bbeb692d22daaab74f6cbf2c4691#code)
- GnosisSafe
- Gnosis Multisig
- Diamond Proxies ([ERC2535](https://eips.ethereum.org/EIPS/eip-2535) / multi-facet proxies)
- Simple Tokens ([ERC20](https://eips.ethereum.org/EIPS/eip-20))
- NFTs ([ERC721](https://eips.ethereum.org/EIPS/eip-721))
- MultiTokens ([ERC1155](https://eips.ethereum.org/EIPS/eip-1155))
- FlashLoan lenders and receivers ([ERC3156](https://eips.ethereum.org/EIPS/eip-3156))
- Contract Registries ([ERC1820](https://eips.ethereum.org/EIPS/eip-1820))
- Offchain Resolvers ([ERC3668](https://eips.ethereum.org/EIPS/eip-3668))

## How to use

`yarn add evmdecoder` or `npm install evmdecoder` to install.

### Decode function call

```typescript
import { EvmDecoder } from 'evmdecoder'

const evmDecoder = new EvmDecoder({
  eth: {
    url: 'http://localhost:8545'
  },
  abi: {
    directory: './abis'
  }
})
await evmDecoder.initialize()

// ethereum tx hash: 0xd698c9191a88c253a926ef1d7eecf22bea9370a0d8dc7fb9e819bad0ae0f1d9e
const input =
  '0xe63d38ed000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000200000000000000000000000083d50977190c592bb9f03054500b1fd81b53dd49000000000000000000000000dc7cd9b725726f5dcd646d3a2c768e4636a89578000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000002c68af0bb14000000000000000000000000000000000000000000000000000002c68af0bb140000'
const functionCall = await evmDecoder.decodeFunctionCall({ input })
console.log(JSON.stringify(functionCall))
```

Output:

```json
{
  "name": "disperseEther",
  "signature": "disperseEther(address[],uint256[])",
  "params": [
    {
      "name": "recipients",
      "type": "address[]",
      "value": ["0x83D50977190c592BB9F03054500B1fd81B53Dd49", "0xDC7cD9b725726F5Dcd646D3A2C768E4636a89578"]
    },
    {
      "name": "values",
      "type": "uint256[]",
      "value": ["200000000000000000", "200000000000000000"]
    }
  ],
  "args": {
    "recipients": ["0x83D50977190c592BB9F03054500B1fd81B53Dd49", "0xDC7cD9b725726F5Dcd646D3A2C768E4636a89578"],
    "values": ["200000000000000000", "200000000000000000"]
  }
}
```

### Decode NFT transfer

```typescript
import { EvmDecoder } from 'evmdecoder'

const evmDecoder = new EvmDecoder({
  eth: {
    url: 'http://localhost:8545'
  },
  abi: {
    directory: './abis'
  }
})
await evmDecoder.initialize()

const input =
  '0x23b872dd000000000000000000000000e809e745ebd8e37d2ed783b48d328b2b77b7dd2c0000000000000000000000006a60114b678b04be3fa094eb5abdc2d4ecd80769000000000000000000000000000000000000000000000000000000000000005c'
const address = '0x78d61C684A992b0289Bbfe58Aaa2659F667907f8'
const functionCall = await evmDecoder.decodeFunctionCall({ input, address })
console.log(JSON.stringify(functionCall))
```

Output:

```json
{
  "name": "transferFrom",
  "signature": "transferFrom(address,address,uint256)",
  "params": [
    {
      "name": "_from",
      "type": "address",
      "value": "0xE809E745EbD8E37d2ed783b48d328B2b77B7dD2C"
    },
    {
      "name": "_to",
      "type": "address",
      "value": "0x6a60114B678b04Be3FA094eB5aBdC2d4ecD80769"
    },
    {
      "name": "_value",
      "type": "uint256",
      "value": 92
    }
  ],
  "args": {
    "_from": "0xE809E745EbD8E37d2ed783b48d328B2b77B7dD2C",
    "_to": "0x6a60114B678b04Be3FA094eB5aBdC2d4ecD80769",
    "_value": 92
  },
  "extra": {
    "tokenUri": "ipfs://QmUAxNgx55CdusaUAxEF1ua3PNmGaUHbas1vGX6qBr1awz/76.json"
  }
}
```

### Identify contract

ERC20:

```typescript
import { EvmDecoder } from 'evmdecoder'

const evmDecoder = new EvmDecoder({
  eth: {
    url: 'http://localhost:8545'
  }
})
await evmDecoder.initialize()

// USDC
const address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const info = await evmDecoder.contractInfo({ address })
console.log(JSON.stringify(info))
```

Output:

```json
{
  "isContract": true,
  "fingerprint": "5157940bcbc1f14cc9cd9b04787267e55a3cb6455b14d6eb8fdb2d7f1057a3aa",
  "contractName": "ERC20_Proxy",
  "contractType": {
    "name": "Token",
    "proxies": [
      {
        "address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        "standard": "ERC897",
        "target": "0xa2327a938febf5fec13bacfb16ae10ecbc4cbdcf"
      }
    ],
    "standards": ["ERC20"]
  },
  "properties": {
    "name": "USD Coin",
    "symbol": "USDC",
    "decimals": "6"
  }
}
```

NFT:

```typescript
import { EvmDecoder } from 'evmdecoder'

const evmDecoder = new EvmDecoder({
  eth: {
    url: 'http://localhost:8545'
  }
})
await evmDecoder.initialize()

// SUPERGUCCI
const address = '0x78d61C684A992b0289Bbfe58Aaa2659F667907f8'
const info = await evmDecoder.contractInfo({ address })
console.log(JSON.stringify(info))
```

Output:

```json
{
  "isContract": true,
  "fingerprint": "188e6dbcca2606630ad5b1ac09ae26f317820d1e230b5be637a06ff69436dc86",
  "contractType": {
    "name": "NFT",
    "metadata": true,
    "baseUri": false,
    "enumeration": true,
    "receive": ["ERC721"],
    "standards": ["ERC721"]
  },
  "properties": {
    "name": "SUPERPLASTIC: SUPERGUCCI",
    "symbol": "SPGCI",
    "totalSupply": "500"
  }
}
```

### Config options

Defaults shown

```typescript
{
  eth: {
    http: {
      timeout: 60_000,
      validateCertificate: false,
      requestKeepAlive: true,
      maxSockets: 256
    },
    client: {
      maxBatchSize: 100,
      maxBatchTime: 0,
      individualReceipts: true,
      maxRetryTime: 10_000
    }
  },
  abi: {
    abiFileExtension: '.json',
    directory: './abis',
    searchRecursive: true,
    fingerprintContracts: true,
    requireContractMatch: false,
    decodeAnonymous: true,
    reconcileStructShapeFromTuples: true
  },
  contractInfo: {
    maxCacheEntries: 25_000
  }
}
```

## Dev Setup

**Prerequisites**

- [Node.js](https://nodejs.org/) 12+ (16 recommended)
- [Yarn package manager](https://yarnpkg.com/) (recent/latest version)
- [Rust toolchain](https://rustup.rs/) (rustc 1.41.0+)
- [wasm-pack](https://rustwasm.github.io/wasm-pack/) (recent/latest version)

1. Clone Repo
2. Install dependencies

```sh-session
yarn install
```

3. Build

```sh-session
yarn build
```

before committing, run `yarn format` and re-add anything updated.
