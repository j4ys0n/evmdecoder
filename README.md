# EvmDecoder

A library to fetch and decode smart contract related bytecode data from an EVM node.

EvmDecoder can determine if an address is a contract and (for supported types) return information and/or properties of the contract. It can also decode transaction input data when provided with the respective (or matching) ABIs.

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
