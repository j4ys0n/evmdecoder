import { EvmDecoder } from '../src' //evmdecoder
;(async () => {
  const evmDecoder = new EvmDecoder({ eth: { url: 'http://localhost:8545' } })
  await evmDecoder.initialize()

  // ethereum tx hash: 0xd698c9191a88c253a926ef1d7eecf22bea9370a0d8dc7fb9e819bad0ae0f1d9e
  const input =
    '0xe63d38ed000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000200000000000000000000000083d50977190c592bb9f03054500b1fd81b53dd49000000000000000000000000dc7cd9b725726f5dcd646d3a2c768e4636a89578000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000002c68af0bb14000000000000000000000000000000000000000000000000000002c68af0bb140000'
  const functionCall = await evmDecoder.decodeFunctionCall({ input })
  console.log(JSON.stringify(functionCall))

  // USDC
  const usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
  const usdcInfo = await evmDecoder.contractInfo({ address: usdcAddress })
  console.log(JSON.stringify(usdcInfo))

  // SUPERGUCCI
  const nftAddress = '0x78d61C684A992b0289Bbfe58Aaa2659F667907f8'
  const nftInfo = await evmDecoder.contractInfo({ address: nftAddress })
  console.log(JSON.stringify(nftInfo))
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
