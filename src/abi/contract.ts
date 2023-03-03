import { createModuleDebug, TRACE_ENABLED } from '@splunkdlt/debug-logging'
import { cachedAsync, Cache, NoopCache } from '@splunkdlt/cache'
import { EthereumClient } from '../eth/client'
import { getCode } from '../eth/requests'
import { sha3 } from './wasm'
import { Classification } from '../utils/classification'
import { AbiRepository } from './repo'

const { info, debug, trace, warn } = createModuleDebug('abi:contract')

export type Address = string

export interface ContractProxy {
  address: string
  standard?: string
  subType?: string
  target?: string
}

export interface ContractType {
  name: string | null
  subType?: string
  standards?: string[]
  proxies?: ContractProxy[]
  metadata?: boolean
  baseUri?: boolean
  tokenUri?: boolean
  enumeration?: boolean
  receive?: string[]
}

export interface TokenProperties {
  type: string
  name: string
  symbol: string
  decimals?: number
  totalSupply?: number
  baseUri?: string
  items?: string[]
}

export interface MultiSigProperties {
  type: string
  owners: string[]
}

export interface ERC3668Properties {
  type: string
  url: string
}

export interface ContractInfo {
  /** True if the corresponding account is a smart contract, otherwise false */
  isContract: boolean
  /** A unique representation of all function and event signatures of a contract */
  fingerprint?: string
  /** Name of the contract from configured ABIs */
  contractName?: string
  /** Type of contract from signature matching */
  contractType?: ContractType
  /** Token properties (if ERC20, ERC721, ERC777, ERC1155) */
  properties?: TokenProperties | MultiSigProperties | ERC3668Properties
}

/** Lookup function to find matching signature for a hash */
export type SignatureMatcher = (sig: string, address?: Address) => string | undefined

/** Lookup function to find name for a given contract address or fingerprint */
export type ContractNameLookup = (address: Address, fingerprint: string) => string | undefined

/**
 * Find function and event signature hashes in the EVM bytecode and attempt to match them against
 * known hashes from configured ABIs
 */
export function extractFunctionsAndEvents(
  contractCode: string,
  signatureMatcher: SignatureMatcher
): { functions: string[]; events: string[] } | undefined {
  const functionMatches: Set<string> = new Set()
  const eventMatches: Set<string> = new Set()
  const code = Buffer.from(contractCode.slice(2), 'hex')
  for (let i = 0, len = code.length; i < len; i++) {
    const opcode = code[i]
    // Look for PUSH<n> opcodes - their pushData may contain a log topic or function signature hash
    if (opcode >= 0x60 && opcode <= 0x7f) {
      const dataLength = opcode - 0x5f
      if (dataLength === 32 || dataLength === 4) {
        const data = code.slice(i + 1, i + dataLength + 1).toString('hex')
        const match = signatureMatcher(data)
        if (match) {
          ;(dataLength === 4 ? functionMatches : eventMatches).add(match)
        }
      }
      i += dataLength
    }
  }

  const functions = [...functionMatches].sort()
  const events = [...eventMatches].sort()
  return { functions, events }
}

/** Creates a hash of all function and event signatures of a contract used to match ABIs against EVM bytecode */
export function computeContractFingerprint(
  { functions, events }: { functions: string[]; events: string[] } = { functions: [], events: [] }
): string | undefined {
  if (functions.length === 0 && events.length === 0) {
    return
  }
  const fingerprint = sha3(`${functions.join(',')}|${events.join(',')}`)!.slice(2)
  return fingerprint
}

/**
 * Attempts to determine if the given account address is a smart contract and
 * determines some additional information if that's the case
 */
export async function getContractInfo(
  address: Address,
  ethClient: EthereumClient,
  classification: Classification,
  signatureMatcher?: SignatureMatcher,
  contractNameLookup?: ContractNameLookup
): Promise<ContractInfo> {
  debug('Retrieving contract information for address %s', address)
  if (signatureMatcher == null) {
    return { isContract: true }
  }
  const code = await ethClient.request(getCode(address))
  if (code === '0x') {
    return { isContract: false }
  }
  const fnsEvts = extractFunctionsAndEvents(code, (fingerprint: string) => signatureMatcher(fingerprint, address))
  const fingerprint = computeContractFingerprint(fnsEvts)
  if (TRACE_ENABLED) {
    trace('Computed fingerprint %s from contract code %O', fingerprint, fnsEvts)
  }
  const contractName =
    fingerprint != null && contractNameLookup != null ? contractNameLookup(address, fingerprint) : undefined
  const contractType = await classification.classifyContract(address, code)
  const properties = await getContractProperties(classification, contractType, address)
  return {
    isContract: true,
    fingerprint,
    contractName,
    contractType,
    properties
  }
}

async function getContractProperties(
  classification: Classification,
  contractType: ContractType,
  address: string
): Promise<TokenProperties | MultiSigProperties | ERC3668Properties | undefined> {
  const isGnosis = contractType.name != null ? contractType.name.includes('Gnosis') : false
  if (contractType.standards != null || isGnosis) {
    // const target = (Array.isArray(contractType.proxies) && !isGnosis)
    //     ? contractType.proxies[contractType.proxies.length -1].target
    //     : address;
    const target = address
    if (target != null) {
      try {
        const properties = await classification.getContractProperties(target, contractType)
        return properties
      } catch (e) {
        warn(`Couldn't get properties %s (%s)`, target, (e as any).message)
      }
    }
  }
  return undefined
}

export async function contractInfo({
  address,
  ethBatchClient,
  abiRepo,
  contractInfoCache = new NoopCache(),
  classification
}: {
  address: Address
  ethBatchClient: EthereumClient
  abiRepo: AbiRepository
  contractInfoCache: Cache<string, Promise<ContractInfo>>
  classification: Classification
}): Promise<ContractInfo | undefined> {
  if (abiRepo == null) {
    return
  }
  const result = await cachedAsync(address, contractInfoCache, (addr: Address) =>
    getContractInfo(
      addr,
      ethBatchClient,
      classification,
      (sig: string) => abiRepo.getMatchingSignature(sig),
      (address: string, fingerprint: string) =>
        abiRepo.getContractByAddress(address)?.contractName ??
        abiRepo.getContractByFingerprint(fingerprint)?.contractName
    )
  )
  return result
}
