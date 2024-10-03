import { EvmDecoder } from '../src' //evmdecoder
;(async () => {
  const evmDecoder = new EvmDecoder({ eth: { url: 'http://localhost:8545' } })
  await evmDecoder.initialize()

  console.log('--> decoded function call <--')
  // ethereum tx hash: 0xd698c9191a88c253a926ef1d7eecf22bea9370a0d8dc7fb9e819bad0ae0f1d9e
  const input =
    '0xe63d38ed000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000200000000000000000000000083d50977190c592bb9f03054500b1fd81b53dd49000000000000000000000000dc7cd9b725726f5dcd646d3a2c768e4636a89578000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000002c68af0bb14000000000000000000000000000000000000000000000000000002c68af0bb140000'
  const functionCall = await evmDecoder.decodeFunctionCall({ input })
  console.log(JSON.stringify(functionCall))

  console.log('--> contract info ERC20 <--')
  // USDC
  const usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
  const usdcInfo = await evmDecoder.contractInfo({ address: usdcAddress })
  console.log(JSON.stringify(usdcInfo))

  console.log('--> contract info ERC721 <--')
  // SUPERGUCCI
  const nftAddress = '0x78d61C684A992b0289Bbfe58Aaa2659F667907f8'
  const nftInfo = await evmDecoder.contractInfo({ address: nftAddress })
  console.log(JSON.stringify(nftInfo))

  console.log('--> decoded function call, NFT <--')
  const nftSend =
    '0x23b872dd000000000000000000000000e809e745ebd8e37d2ed783b48d328b2b77b7dd2c0000000000000000000000006a60114b678b04be3fa094eb5abdc2d4ecd80769000000000000000000000000000000000000000000000000000000000000005c'
  const nftFunctionCall = await evmDecoder.decodeFunctionCall({ input: nftSend, address: nftAddress })
  console.log(JSON.stringify(nftFunctionCall))

  console.log('--> decoded transaction <--')
  const usdcTxHash = '0x1523032cba61b24e77077f550cd6bea8f4fcda80e78cb3d3888207dcac60be90'
  const decodedTx = await evmDecoder.getTransaction(usdcTxHash)
  console.log(JSON.stringify(decodedTx))

  console.log('--> decoded block <--')
  const blockNumber = 14354151
  const decodedBlock = await evmDecoder.getBlock(blockNumber)
  console.log(JSON.stringify(decodedBlock))

  console.log('--> internal transaction <--')
  const txnHash = '0xbb4b3fc2b746877dce70862850602f1d19bd890ab4db47e6b7ee1da1fe578a0d'
  const internalTransaction = await evmDecoder.getInternalTransaction(txnHash, true)
  console.log(JSON.stringify(internalTransaction))

  console.log('--> fee history <--')
  const blockCount = 10
  const blockTarget = 20_000_000
  const feeHistory = await evmDecoder.getFeeHistory(blockCount, blockTarget)
  console.log(JSON.stringify(feeHistory))
})()

/**

{
   "name":"disperseEther",
   "signature":"disperseEther(address[],uint256[])",
   "params":[
      {
         "name":"recipients",
         "type":"address[]",
         "value":[
            "0x83D50977190c592BB9F03054500B1fd81B53Dd49",
            "0xDC7cD9b725726F5Dcd646D3A2C768E4636a89578"
         ]
      },
      {
         "name":"values",
         "type":"uint256[]",
         "value":[
            "200000000000000000",
            "200000000000000000"
         ]
      }
   ],
   "args":{
      "recipients":[
         "0x83D50977190c592BB9F03054500B1fd81B53Dd49",
         "0xDC7cD9b725726F5Dcd646D3A2C768E4636a89578"
      ],
      "values":[
         "200000000000000000",
         "200000000000000000"
      ]
   }
}

{
  "isContract":true,
  "fingerprint":"5157940bcbc1f14cc9cd9b04787267e55a3cb6455b14d6eb8fdb2d7f1057a3aa",
  "contractName":"PriceAggregator_Proxy",
  "contractType":{
    "name":"Token",
    "proxies":[
      {
        "address":"0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        "standard":"ERC897",
        "target":"0xa2327a938febf5fec13bacfb16ae10ecbc4cbdcf"
      }
    ],
    "standards":[
        "ERC20"
    ]
  },
  "properties":{
    "name":"USD Coin",
    "symbol":"USDC",
    "decimals":"6"
  }
}

{
   "isContract":true,
   "fingerprint":"188e6dbcca2606630ad5b1ac09ae26f317820d1e230b5be637a06ff69436dc86",
   "contractType":{
      "name":"NFT",
      "metadata":true,
      "baseUri":false,
      "enumeration":true,
      "receive":[
         "ERC721"
      ],
      "standards":[
         "ERC721"
      ]
   },
   "properties":{
      "name":"SUPERPLASTIC: SUPERGUCCI",
      "symbol":"SPGCI",
      "totalSupply":"500"
   }
}

 */
