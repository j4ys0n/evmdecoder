import { join } from 'path'
import { computeContractFingerprint, extractFunctionsAndEvents } from '../../src/abi/contract'
import { AbiRepository } from '../../src/abi/repo'
import { readFile } from 'fs-extra'
import { Classification } from '../../src/utils/classification'
import { EthereumClient } from '../../src/eth/client'
import { HttpTransport } from '../../src/eth/http'

test('extractFunctionsAndEvents', async () => {
  const config = {
    decodeAnonymous: false,
    fingerprintContracts: true,
    abiFileExtension: '.json',
    requireContractMatch: true,
    reconcileStructShapeFromTuples: false
  }
  const abis = new AbiRepository(config)
  await abis.loadAbiFile(join(__dirname, '../abis/BCB.json'), config)
  const fne = extractFunctionsAndEvents(
    await readFile(join(__dirname, '../fixtures/contract1.txt'), { encoding: 'utf-8' }),
    (sig: string) => abis.getMatchingSignature(sig)
  )
  expect(fne).toMatchInlineSnapshot(`
        Object {
          "events": Array [
            "Approval(address,address,uint256)",
            "OwnershipTransferred(address,address)",
            "Transfer(address,address,uint256)",
            "TransferWithData(address,address,uint256,bytes)",
          ],
          "functions": Array [
            "allowance(address,address)",
            "approve(address,uint256)",
            "balanceOf(address)",
            "burn(address,uint256)",
            "decimals()",
            "decreaseAllowance(address,uint256)",
            "increaseAllowance(address,uint256)",
            "isOwner()",
            "mint(address,uint256)",
            "name()",
            "owner()",
            "renounceOwnership()",
            "symbol()",
            "totalSupply()",
            "transfer(address,uint256)",
            "transferFrom(address,address,uint256)",
            "transferOwnership(address)",
            "transferWithData(address,uint256,bytes)",
          ],
        }
    `)

  expect(computeContractFingerprint(fne)).toMatchInlineSnapshot(
    `"30f0d1068a77a3aaa446f680f4aa961c9e981bff9aba4a0962230867d0f3ddf9"`
  )
})

test('extractFunctionsAndEvents BAYC', async () => {
  const config = {
    decodeAnonymous: false,
    fingerprintContracts: true,
    abiFileExtension: '.json',
    requireContractMatch: false,
    reconcileStructShapeFromTuples: false
  }

  const abis = new AbiRepository(config)
  await abis.loadAbiFile(join(__dirname, '../abis/ERC721.json'), config)
  const fne = extractFunctionsAndEvents(
    await readFile(join(__dirname, '../fixtures/bayc.txt'), { encoding: 'utf-8' }),
    (sig: string) => abis.getMatchingSignature(sig)
  )

  expect(fne).toMatchInlineSnapshot(`
        Object {
          "events": Array [
            "Approval(address,address,uint256)",
            "ApprovalForAll(address,address,bool)",
            "Transfer(address,address,uint256)",
          ],
          "functions": Array [
            "approve(address,uint256)",
            "balanceOf(address)",
            "getApproved(uint256)",
            "isApprovedForAll(address,address)",
            "name()",
            "ownerOf(uint256)",
            "safeTransferFrom(address,address,uint256)",
            "safeTransferFrom(address,address,uint256,bytes)",
            "setApprovalForAll(address,bool)",
            "symbol()",
            "tokenByIndex(uint256)",
            "tokenOfOwnerByIndex(address,uint256)",
            "tokenURI(uint256)",
            "totalSupply()",
            "transferFrom(address,address,uint256)",
          ],
        }
  `)

  expect(computeContractFingerprint(fne)).toMatchInlineSnapshot(
    `"7ca2c8983d520e011b25cd22ce636471803011e24eda7cc5d529646af87d3ae9"`
  )
})

test('BAYC is classified as NFT', async () => {

  const config = {
    decodeAnonymous: false,
    fingerprintContracts: true,
    abiFileExtension: '.json',
    requireContractMatch: false,
    reconcileStructShapeFromTuples: false
  }

  const abis = new AbiRepository(config)
  await abis.loadAbiFile(join(__dirname, '../abis/ERC721.json'), config)

  const transport = new HttpTransport('http://localhost:8545', {
    timeout: 60_000,
    validateCertificate: false,
    requestKeepAlive: true,
    maxSockets: 256
  })

  const classification = new Classification(new EthereumClient(transport))
  const baycCode = await readFile(join(__dirname, '../fixtures/bayc.txt'), { encoding: 'utf-8' })

  // console.log(classification.implementsErc721(baycCode))
  const c = await classification.classifyContract('0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D', baycCode)
  expect(c).toMatchInlineSnapshot(`
  Object {
    "baseUri": true,
    "enumeration": false,
    "metadata": false,
    "name": "NFT",
    "receive": Array [
      "ERC721",
    ],
    "standards": Array [
      "ERC721",
    ],
    "tokenUri": true,
  }
  `)
})
