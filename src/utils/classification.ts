import { createModuleDebug } from '@splunkdlt/debug-logging'
import {
  ContractType,
  TokenProperties,
  MultiSigProperties,
  ContractProxy,
  ERC3668Properties,
  ContractInfo
} from '../abi/contract'
import { getStorageAt, getCode, call, encodeParameter } from '../eth/requests'
import { EthereumClient } from '../eth/client'

export type Value = string | number | boolean | Array<string | number | boolean>

export type DecodedStruct = { [k: string]: Value | DecodedStruct } | DecodedStruct[]

export interface FunctionCall {
  /** Function name */
  name: string
  /** Function signature (name and parameter types) */
  signature: string
  /** List of decoded parameters */
  params: Array<{
    /** Paramter name - omitted if the function call was decoded anonymously */
    name?: string
    /** Data type */
    type: string
    /** Decoded value */
    value: Value | DecodedStruct
  }>
  /**
   * A map of parameter names and their decoded value.
   * Omitted if the function call was decoded anonymously
   */
  args?: { [name: string]: Value | DecodedStruct }
  extra?: { [name: string]: Value }
}

const { info, warn, error, debug } = createModuleDebug('abi:classification')

// ABI signature of supportsInterface() function, ERC165
const supportsInterfaceSignature = '01ffc9a7'
// interfaceId passed to 'supportsInterface' for erc721
const erc721InterfaceId = '80ac58cd'
// interfaceId passed to 'supportsInterface' for erc721 receiving contract
const erc721ReceivingInterfaceId = '150b7a02'
// interfaceId passed to 'supportsInterface' for erc721 with metadata extension
const erc721MetadataInterfaceId = '5b5e139f'
// interfaceId passed to 'supportsInterface' for erc721 with enumeration extension
const erc721EnumerationInterfaceId = '780e9d63'
// interfaceId passed to 'supportsInterface' for erc1155
const erc1155InterfaceId = 'd9b67a26'
// interfaceId passed to 'supportsInterface' for erc1155 receiving contract
const erc1155ReceivingInterfaceId = '4e2312e0'
// interfaceId passed to 'supportsInterface' for erc1155 with metadata extension
const erc1155MetadataInterfaceId = '0e89341c'
// regex to identify a minimal proxy contract clone, and will extract the address of the contract being cloned.
const minimalProxyIdentifierRegex = /363d3d373d3d3d363d73(?<clonedAddress>[a-f0-9]{40})5af43d82803e903d91602b57fd5bf3/
// regex to identify a metaproxy contract clone, and will extract the address of the contract being cloned.
const metaProxyIdentifierRegex = /363d3d373d3d3d3d60368038038091363936013d73(?<clonedAddress>[a-f0-9]{40})5af43d3d93803e603457fd5bf3/
// regex to identify simple multisig wallet clone example: https://etherscan.io/address/0x5b9e8728e316bbeb692d22daaab74f6cbf2c4691#code
const simpleMultisigCloneRegex = /0x36600080376020600036600073(?<clonedAddress>[a-f0-9]{40})6102c65a03f41515602d57fe5b60206000f3/
// event emitted by proxy contracts - derived from keccak256('Upgraded(address)')
const upgradedEvent = 'bc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b'
// storage ref to underlying contract - derived from bytes32(uint256(keccak256('eip1967.proxy.implementation')) - 1))
const eip1967StorageSlot = '360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
// storage ref to underlying contract - derived from keccak256('org.zeppelinos.proxy.implementation') (EIP 897 / DelegateProxy)
const openZeppelinStorageSlot = '7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3'
// storage ref to underlying contract on polygon - derived from keccak256('matic.network.proxy.implementation')
const polygonStorageSlot = 'baab7dbf64751104133af04abc7d9979f0fda3b059a322a8333f533d3f32bf7f'
// storage ref to underlying contract using the Universal Upgradeable Proxy pattern - derived from keccak256('PROXIABLE')
const eip1822StorageSlot = 'c5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7'
// storage id for the GnosisSafe Proxy pattern
const gnosisSafeStorageIdentifier = 'ffffffffffffffffffffffffffffffffffffffff'
// storage ref to underlying contract using the GnosisSafe Proxy pattern
const gnosisSafeStorageSlot = '0x0'
// 0xa619486e == keccak("masterCopy()"). The value is right padded to 32-bytes with 0s
const gnosisSafeCallDataLoadIdentifier = 'a619486e00000000000000000000000000000000000000000000000000000000'
// signature of getOwners() method
const gnosisGetOwnersSignature = 'a0e67e2b'
// ABI signature of diamondCut() function used by Diamond Prioxies (EIP 2535)
const gnosisIsOwnerSignature = '2f54bf6e'
const gnosisRequiredSignature = 'dc8452cd'
const gnosisIsConfirmedBytes32Signature = '6486aa51'
const gnosisIsConfirmedUint256Signature = '784547a7'
const diamondCutSignature = '1f931c1c'
// ABI signature of diamondFacetAddress() function used by Diamond Prioxies (EIP 2535)
const diamondFacetAddressSignature = 'cdffacc6'
// ABI signature of diamondFacets() function used by Diamond Prioxies (EIP 2535)
const diamondFacetsSignature = '7a0ed627'
// event emitted by erc20 contracts - derived from keccak256('Transfer(address,address,uint256)')
const transferEvent = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
// ABI signature of implementation() function - 897, 1967
const implementationSignature = '5c60da1b'
// ABI signature of proxyType() function - 897
const proxyTypeSignature = '4555d5c9'
// ABI signature of fallback() function - 1967
const fallbackSignature = '552079dc'
// ABI signature of proxiableUUID() function - 1822
const proxiableUUIDSignature = '52d1902d'
// ABI signature of name() function
const nameSignature = '06fdde03'
// ABI signature of symbol() function
const symbolSignature = '95d89b41'
// ABI signature of decimals() function
const decimalsSignature = '313ce567'
// ABI signature of isSet(address) function
const isSetSignature = '74ebe3ec'
// ABI signature of baseURI() function
const baseUriSignature = '6c0360eb'
// ABI signature of totalSupply() function
const totalSupplySignature = '18160ddd'
// ABI signature of tokenByIndex(uint256) function
const tokenByIndexSignature = '4f6ccce7'
// ABI signature of tokenURI(uint256) function
const tokenURISignature = 'c87b56dd'
// ABI signature of Transfer(address,address,uint256)
const transferErc721Signature = 'ddf252ad'
// ABI signature of Approval(address,address,uint256)
const approvalErc721Signature = '8c5be1e5'
// ABI signature of ApprovalForAll(address,address,bool)
const approvalForAllSignature = '17307eab'
// ABI signature of ownerOf(uint256)
const ownerOfSignature = '6352211e'
// ABI signature of safeTransferFrom(address,address,uint256,bytes)
const safeTransferFromBytesSignature = 'b88d4fde'
// ABI signature of safeTransferFrom(address,address,uint256) function
const safeTransferFromSignature = '42842e0e'
// ABI signature of transferFrom(address,address,uint256) function
const transferFromSignature = '23b872dd'
// ABI signature of approve(address,uint256)
const approveSignature = '095ea7b3'
// ABI signature of setApprovalForAll(address,bool)
const setApprovalForAll = 'a22cb465'
// ABI signature of getApproved(uint256)
const getApprovedSignature = '081812fc'
// ABI signature of isApprovedForAll(address,address)
const isApprovedForAll = 'e985e9c5'
// ABI signature of balanceOf(address) function
const balanceOfSignature = '70a08231'
// ABI signature of flashLoan(address,address,uint256,bytes) function
const flashLoanSignature = '5cffe9de'
// ABI signature of maxFlashLoan(address) function
const maxFlashLoanSignature = '613255ab'
// ABI signature of onFlashLoan(address,address,uint256,uint256,bytes) function
const onFlashLoanSignature = '23e30c8b'
// ERC1820 Registry ERC1820_ACCEPT_MAGIC hex
const erc1820AcceptMagicHex = '455243313832305f4143434550545f4d41474943'
// ERC1820 canImplementInterfaceForAddress signature identifier
const erc1820CanImplementInterface = 'f0083250'
// ERC1820 getInterfaceImplementer signature identifier
const erc1820GetInterfaceImplementer = 'aabbb8ca'
// ERC1820 setInterfaceImplementer signature identifier
const erc1820SetInterfaceImplementer = '29965a1d'
// ERC1820 updateERC165Cache signature identifier
const erc1820UpdateERC165Cache = 'a41e7d51'
// ERC3668 resolveWithProof signature identifier
const erc3668ResolveWithProofSignature = 'f4d4d2f8'
// ERC3668 makeSignatureHash signature identifier
const erc3668MakeSignatureHashSignature = '1dcfea09'
// ERC3668 NewSigners signature identifier
const erc3668NewSignersSignature = 'ab0b9cc3a46b568cb08d985497cde8ab7e18892d01f58db7dc7f0d2af859b2d7'
// ERC3668 url signature
const erc3668UrlSignature = '5600f04f'

export class Classification {
  private ethClient: EthereumClient

  constructor(ethClient: EthereumClient) {
    this.ethClient = ethClient
  }

  private removeAddressPadding(encodedAddress: string): string | undefined {
    const len = encodedAddress.length
    if (len > 20) {
      return `0x${encodedAddress.substring(len - 40)}`
    }
    return
  }

  /**
   * Uses the supplied storageSlot from the proxy contract's
   * reference in memory to retrieve the address of the
   * implementation contract
   *
   * @param address
   * @param network
   * @param storageSlot
   */
  private async getImplementationContractAddressFromStorage(
    address: string,
    storageSlotHex: string
  ): Promise<string | undefined> {
    const storageSlot = storageSlotHex.startsWith('0x') ? storageSlotHex : `0x${storageSlotHex}`
    // info(`getting storage for ${address} at ${storageSlot}`)
    const encodedAddress = await this.ethClient.request(getStorageAt(address, storageSlot)).catch(e => {
      warn('Failed to get contract address from storage slot %s %s (%s)', address, storageSlot, (e as any).message)
      return undefined
    })
    // info(`encoded address: ${encodedAddress}`)
    if (!encodedAddress || encodedAddress === '0x0000000000000000000000000000000000000000000000000000000000000000') {
      return
    }
    return encodedAddress ? this.removeAddressPadding(encodedAddress) : undefined
  }

  /**
   * Uses the contract code to determine, and then retrieve
   * a cloned contract address
   *
   * @param tokenId
   * @param network
   * @param code
   * @returns string | null
   */

  private getClonedContractAddress(code: string): string | undefined {
    if (this.isMinimalProxyClone(code)) {
      const match = code.match(minimalProxyIdentifierRegex)
      if (match != null) {
        return match.groups!.clonedAddress
      }
    }
    if (this.isMetaProxyClone(code)) {
      const match = code.match(metaProxyIdentifierRegex)
      if (match != null) {
        return match.groups!.clonedAddress
      }
    }
    if (this.isSimpleMultisigClone(code)) {
      const match = code.match(simpleMultisigCloneRegex)
      if (match != null) {
        return match.groups!.clonedAddress
      }
    }
    return undefined
  }

  /**
   * Returns whether this contract code
   * conforms to the ERC20 token standards
   *
   * @param code
   */
  private isErc20ContractCode(code: string): boolean {
    return !this.isErc721(code) && !this.isErc1155(code) && this.isErc20(code)
  }

  /**
   * Returns whether this contract code
   * implements the ERC721 interfaceId
   *
   * @param code
   */
  public isErc721ContractCode(code: string): boolean {
    return !this.isErc1155(code) && (this.isErc721(code) || this.implementsErc721(code))
  }

  /**
   * Returns whether this contract code
   * conforms to the ERC1155 contract standards
   *
   * @param code
   */
  private isErc1155ContractCode(code: string): boolean {
    return !this.isErc721(code) && !this.isErc20(code) && this.isErc1155(code)
  }

  private async getImplementationAddress(address: string): Promise<string | undefined> {
    try {
      return (await this.ethClient.request(call(address, implementationSignature, 'address'))) as string
    } catch (e) {
      warn(`couldn't get proxied implementation address from %s`, address)
    }
  }

  private async getErc1822StorageSlot(address: string): Promise<string | undefined> {
    try {
      return (await this.ethClient.request(call(address, proxiableUUIDSignature, 'hex'))) as string
    } catch (e) {
      warn(`couldn't get storage slot from %s`, address)
    }
  }

  /**
   * Attempts to classify the contract type.
   */
  public async classifyContract(address: string, code: string, contractType?: ContractType): Promise<ContractType> {
    if (contractType == null) {
      contractType = { name: null }
    }
    const proxies: ContractProxy[] = [...(contractType.proxies ?? [])]
    const initialProxies = proxies.length
    // standard proxies
    if (this.isErc897Proxy(code)) {
      debug('897 proxy detected %s', address)
      if (this.usesOpenZeppelinStorageSlot(code)) {
        const target = await this.getImplementationContractAddressFromStorage(address, openZeppelinStorageSlot)
        const proxy: ContractProxy = { address, standard: 'ERC897', target }
        proxies.push(proxy)
      } else if (this.usesPolygonStorageSlot(code)) {
        const target = await this.getImplementationContractAddressFromStorage(address, polygonStorageSlot)
        const proxy: ContractProxy = { address, standard: 'ERC897', subType: 'Polygon', target }
        proxies.push(proxy)
      } else {
        const target = await this.getImplementationAddress(address)
        if (target != null) {
          const proxy: ContractProxy = { address, standard: 'ERC897', target }
          proxies.push(proxy)
        }
      }
      contractType.proxies = proxies
    }
    if (this.isErc1822Proxy(code)) {
      debug('1822 proxy detected %s', address)
      if (this.usesEip1822StorageSlot(code)) {
        const target = await this.getImplementationContractAddressFromStorage(address, eip1822StorageSlot)
        const proxy: ContractProxy = { address, standard: 'ERC1822', target }
        proxies.push(proxy)
      } else {
        const storageSlot = await this.getErc1822StorageSlot(address)
        if (storageSlot != null) {
          const target = await this.getImplementationContractAddressFromStorage(address, storageSlot)
          if (target != null) {
            const proxy: ContractProxy = { address, standard: 'ERC1822', target }
            proxies.push(proxy)
          }
        }
      }
      contractType.proxies = proxies
    }
    if (this.isErc1967Proxy(code)) {
      debug('1967 proxy detected %s', address)
      if (this.usesEip1967StorageSlot(code)) {
        const target = await this.getImplementationContractAddressFromStorage(address, eip1967StorageSlot)
        const proxy: ContractProxy = { address, standard: 'ERC1967', target }
        proxies.push(proxy)
      } else {
        const target = await this.getImplementationAddress(address)
        if (target != null) {
          const proxy: ContractProxy = { address, standard: 'ERC1967', target }
          proxies.push(proxy)
        }
      }
      contractType.proxies = proxies
    }
    // proxy clones
    if (this.isClone(code)) {
      const proxies: ContractProxy[] = contractType != null ? contractType.proxies ?? [] : []
      const target = this.getClonedContractAddress(code)
      if (this.isMinimalProxyClone(code)) {
        const proxy: ContractProxy = { address, standard: 'ERC1167', subType: 'Clone', target }
        proxies.push(proxy)
      }
      if (this.isMetaProxyClone(code)) {
        const proxy: ContractProxy = { address, standard: 'ERC3448', subType: 'Clone', target }
        proxies.push(proxy)
      }
      if (this.isSimpleMultisigClone(code)) {
        const proxy: ContractProxy = { address, subType: 'Clone (Simple MultiSig)', target }
        proxies.push(proxy)
      }
      contractType.proxies = proxies
    }
    // gnosis safe
    if (this.isGnosisSafe(code)) {
      const proxies: ContractProxy[] = contractType != null ? contractType.proxies ?? [] : []
      const target = await this.getImplementationContractAddressFromStorage(address, gnosisSafeStorageSlot)
      const proxy: ContractProxy = { address, subType: 'GnosisSafe', target }
      proxies.push(proxy)
      contractType.name = 'GnosisSafe'
      contractType.proxies = proxies
    }

    const standards: string[] = [...(contractType.standards ?? [])]

    // old Gnosis multisig
    if (this.isOldGonsisMultiSig(code)) {
      contractType.name = 'GnosisMultisig'
      contractType.subType = 'Deprecated'
    }

    // diamond proxy (multi-facet proxy - non-standard)
    if (this.isDiamondProxy(code)) {
      contractType.name = 'DiamondProxy'
      standards.push('ERC2535')
    }
    // tokens
    if (this.isErc20ContractCode(code)) {
      contractType.name = 'Token'
      standards.push('ERC20')
    }
    if (this.isErc721ContractCode(code)) {
      const metadata = this.hasErc721MetadataExtension(code)
      const baseUri = this.hasErc721BaseUriSupport(code)
      const enumeration = this.hasErc721EnumerationExtension(code)
      const tokenUri = this.hasErc721TokenUriSupport(code)
      contractType.name = 'NFT'
      standards.push('ERC721')
      contractType.metadata = metadata
      contractType.baseUri = baseUri
      contractType.enumeration = enumeration
      contractType.tokenUri = tokenUri
    }
    if (this.isErc1155ContractCode(code)) {
      const metadata = this.hasErc1155MetadataExtension(code)
      contractType.name = 'MultiToken'
      standards.push('ERC1155')
      contractType.metadata = metadata
    }
    // flash loans
    if (this.isFlashLoanLender(code)) {
      const subType = this.isFlashLoanReciever(code) ? 'Lender/Receiver' : 'Lender'
      contractType.name = 'FlashLoan'
      contractType.subType = subType
      standards.push('ERC3156')
    }
    const receive = this.canReceive(code)
    if (receive.length > 0) {
      contractType.receive = receive
    }
    // token contract registry
    if (this.isErc1820Registry(code)) {
      contractType.name = 'ContractRegistry'
      standards.push('ERC1820')
    }
    // off chain lookup
    if (this.isErc3668(code)) {
      contractType.name = 'OffchainResolver'
      standards.push('ERC3668')
    }

    if (standards.length > 0) {
      contractType.standards = standards
    }
    const numProxies = proxies.length

    try {
      if (numProxies > initialProxies) {
        const lastProxyAddress = contractType?.proxies![contractType.proxies?.length! - 1]
        if (lastProxyAddress.target != null) {
          const nextCode = await this.ethClient.request(getCode(lastProxyAddress.target))
          return await this.classifyContract(lastProxyAddress.target, nextCode, contractType)
        }
      }
    } catch (e) {
      warn(
        'Unable to get next contract in recusive proxy chain. %s, %s',
        JSON.stringify(contractType),
        (e as any).message
      )
    }
    return contractType
  }

  public async getNFTId(address: string, index: number): Promise<string | undefined> {
    const encodedIndex = encodeParameter(index, 'uint256')
    const callData = this.getErc721IdByIndex(encodedIndex)
    return await this.ethClient.request(call(address, callData, 'uint256')).catch(e => {
      warn("Couldn't get NFT id %s. (%s)", encodedIndex, (e as any).message)
      return undefined
    })
  }

  public async getNFTUri(address: string, id: string): Promise<string | undefined> {
    const callData = this.getErc721UriById(id)
    return await this.ethClient.request(call(address, callData, 'string')).catch(e => {
      warn("Couldn't get NFT URI of %s from %s. (%s)", id, address, (e as any).message)
      return undefined
    })
  }

  public async determineNFTUri(
    address: string,
    callInfo: FunctionCall,
    toInfo: ContractInfo
  ): Promise<string | undefined> {
    if (toInfo.contractType) {
      if (toInfo.contractType.baseUri && toInfo.properties) {
        const baseUri = (toInfo.properties as TokenProperties).baseUri
        if (baseUri) {
          let nftUri
          try {
            nftUri = await this.getNFTUri(address, encodeParameter(<number>callInfo.params[2].value, 'uint256'))
          } catch (e) {
            warn("Couldn't get NFT URI. (%s %s)", address, (e as any).message)
          }
          if (nftUri) {
            return nftUri
          }
          const slash = baseUri.lastIndexOf('/') === baseUri.length - 1 ? '' : '/'
          return `${baseUri}${slash}${callInfo.params[2].value}`
        }
      }
      let tokenId
      try {
        tokenId = toInfo.contractType.enumeration
          ? await this.getNFTId(address, <number>callInfo.params[2].value)
          : encodeParameter(<number>callInfo.params[2].value, 'uint256')
      } catch (e) {
        warn("Couldn't get NFT ID on first pass. (%s)", (e as any).message)
      }
      if (!tokenId && callInfo.params[2]) {
        tokenId = encodeParameter(<number>callInfo.params[2].value, 'uint256')
      } else if (tokenId && (!tokenId.startsWith('0x') || tokenId.length < 66)) {
        tokenId = encodeParameter(tokenId, 'uint256')
      }
      if (tokenId && toInfo.contractType.tokenUri) {
        let nftUri
        try {
          nftUri = await this.getNFTUri(address, tokenId)
        } catch (e) {
          warn("Couldn't get NFT URI. (%s %s)", address, (e as any).message)
        }
        if (nftUri) {
          return nftUri
        }
      }
    }
    return undefined
  }

  public async getExtraData(
    address: string,
    callInfo: FunctionCall,
    toInfo: ContractInfo,
    input?: string
  ): Promise<FunctionCall> {
    let extra: { [name: string]: Value } = {}
    // try to get ERC721 tokenURI on transfer
    if (((input &&
      // function call
      (input.startsWith(`0x${transferFromSignature}`) 
      || input.startsWith(`0x${safeTransferFromSignature}`)
      || input.startsWith(`0x${safeTransferFromBytesSignature}`)))
      // event
      ||( callInfo.signature === 'Transfer(address,address,uint256)')
      && toInfo.contractType?.standards?.includes('ERC721'))
    ) {
      const tokenUri = await this.determineNFTUri(address, callInfo, toInfo)
      if (tokenUri != null) {
        extra = { ...extra, tokenUri }
      }
    }
    if (Object.keys(extra).length > 0) {
      return { ...callInfo, extra }
    }
    return callInfo
  }

  private tryParseDecimals(input: any) {
    if (input != null && typeof input === 'string') {
      try {
        const decimals = parseInt(input, 10)
        return decimals
      } catch (e) {}
    }
    return input
  }

  public async getContractProperties(
    address: string,
    contractType: ContractType
  ): Promise<TokenProperties | MultiSigProperties | ERC3668Properties | undefined> {
    if (contractType.standards != null) {
      if (contractType.standards.includes('ERC20')) {
        const type = 'ERC20'
        // get name
        const name = await this.ethClient.request(call(address, nameSignature, 'string'))
        // get symbol
        const symbol = await this.ethClient.request(call(address, symbolSignature, 'string'))
        // get decimals
        const decimalsRaw = await this.ethClient.request(call(address, decimalsSignature, 'uint256'))
        const decimals = this.tryParseDecimals(decimalsRaw)
        return { type, name, symbol, decimals }
      }
      if (contractType.standards.includes('ERC721')) {
        const type = 'ERC721'
        // get name
        const name = await this.ethClient.request(call(address, nameSignature, 'string'))
        // get symbol
        const symbol = await this.ethClient.request(call(address, symbolSignature, 'string'))
        const baseUri = contractType.baseUri
          ? await this.ethClient.request(call(address, baseUriSignature, 'string'))
          : undefined
        const totalSupply = contractType.enumeration
          ? await this.ethClient.request(call(address, totalSupplySignature, 'uint256'))
          : undefined

        return { type, name, symbol, baseUri, totalSupply }
      }
      if (contractType.standards.includes('ERC3668')) {
        const type = 'ERC3668'
        const url = await this.ethClient.request(call(address, erc3668UrlSignature, 'string'))
        return { type, url }
      }
    }
    if (contractType.name === 'GnosisMultisig' || contractType.name === 'GnosisSafe') {
      const type = contractType.name
      const owners: string[] = await this.ethClient.request(call(address, gnosisGetOwnersSignature, 'address[]'))
      return { type, owners }
    }
  }

  private canReceive(code: string): string[] {
    const receive: string[] = []
    if (this.isErc721Receiver(code)) {
      receive.push('ERC721')
    }
    if (this.isErc1155Receiver(code)) {
      receive.push('ERC1155')
    }
    if (this.isFlashLoanReciever(code)) {
      receive.push('ERC3156')
    }
    return receive
  }

  private usesEip1967StorageSlot = (code: string): boolean => code.includes(eip1967StorageSlot)
  private usesOpenZeppelinStorageSlot = (code: string): boolean => code.includes(openZeppelinStorageSlot)
  private usesPolygonStorageSlot = (code: string): boolean => code.includes(polygonStorageSlot)
  private usesEip1822StorageSlot = (code: string): boolean => code.includes(eip1822StorageSlot)
  private usesGnosisSafeStorageSlot = (code: string): boolean => code.includes(gnosisSafeStorageIdentifier)
  private isWallet = (code: string): boolean => code === '0x'
  private isErc897Proxy = (code: string): boolean =>
    (code.includes(implementationSignature) && code.includes(proxyTypeSignature)) ||
    this.usesOpenZeppelinStorageSlot(code) ||
    this.usesPolygonStorageSlot(code)
  private isErc1967Proxy = (code: string): boolean =>
    (code.includes(implementationSignature) && code.includes(fallbackSignature) && code.includes(upgradedEvent)) ||
    this.usesEip1967StorageSlot(code)
  private isErc1822Proxy = (code: string): boolean => code.includes(proxiableUUIDSignature)
  private isGnosisSafe = (code: string): boolean =>
    this.usesGnosisSafeStorageSlot(code) && code.includes(gnosisSafeCallDataLoadIdentifier)
  private isOldGonsisMultiSig = (code: string): boolean =>
    code.includes(gnosisIsOwnerSignature) &&
    code.includes(gnosisRequiredSignature) &&
    (code.includes(gnosisIsConfirmedBytes32Signature) || code.includes(gnosisIsConfirmedUint256Signature))
  private isErc721 = (code: string): boolean => code.includes(erc721InterfaceId)
  private isErc721Receiver = (code: string): boolean => code.includes(erc721ReceivingInterfaceId)
  private hasErc721MetadataExtension = (code: string): boolean => code.includes(erc721MetadataInterfaceId)
  private hasErc721EnumerationExtension = (code: string): boolean => code.includes(erc721EnumerationInterfaceId)
  private hasErc721BaseUriSupport = (code: string): boolean => code.includes(baseUriSignature)
  private hasErc721TokenUriSupport = (code: string): boolean => code.includes(tokenURISignature)
  private getErc721IdByIndex = (index: string) => `${tokenByIndexSignature}${index.substring(2)}`
  private getErc721UriById = (id: string) => `${tokenURISignature}${id.substring(2)}`
  private isErc1155 = (code: string): boolean => code.includes(erc1155InterfaceId)
  private isErc1155Receiver = (code: string): boolean => code.includes(erc1155ReceivingInterfaceId)
  private hasErc1155MetadataExtension = (code: string): boolean => code.includes(erc1155MetadataInterfaceId)
  private isErc20 = (code: string): boolean =>
    code.includes(nameSignature) &&
    code.includes(symbolSignature) &&
    code.includes(decimalsSignature) &&
    code.includes(balanceOfSignature) &&
    code.includes(transferEvent) &&
    !code.includes(isSetSignature)
  private isMinimalProxyClone = (code: string): boolean => code.match(minimalProxyIdentifierRegex) !== null
  private isMetaProxyClone = (code: string): boolean => code.match(metaProxyIdentifierRegex) !== null
  private isSimpleMultisigClone = (code: string): boolean => code.match(simpleMultisigCloneRegex) !== null
  private isClone = (code: string): boolean =>
    code.length <= 108 ||
    this.isMinimalProxyClone(code) ||
    this.isMetaProxyClone(code) ||
    this.isSimpleMultisigClone(code)
  private isDiamondProxy = (code: string): boolean =>
    code.includes(diamondCutSignature) &&
    code.includes(diamondFacetsSignature) &&
    code.includes(diamondFacetAddressSignature) &&
    code.includes(supportsInterfaceSignature)
  private supportsInterfaceBytecode = (code: string, interfaceId: string): boolean => code.includes(interfaceId)
  private isFlashLoanLender = (code: string): boolean =>
    code.includes(flashLoanSignature) && code.includes(maxFlashLoanSignature)
  private isFlashLoanReciever = (code: string): boolean => code.includes(onFlashLoanSignature)
  private hasErc1820AcceptMagicHex = (code: string): boolean => code.includes(erc1820AcceptMagicHex)
  private hasErc1820CanImplementInterface = (code: string): boolean => code.includes(erc1820CanImplementInterface)
  private hasErc1820GetInterfaceImplementer = (code: string): boolean => code.includes(erc1820GetInterfaceImplementer)
  private hasErc1820SetInterfaceImplementer = (code: string): boolean => code.includes(erc1820SetInterfaceImplementer)
  private hasErc1820UpdateErc165Cache = (code: string): boolean => code.includes(erc1820UpdateERC165Cache)
  private isErc1820Registry = (code: string): boolean =>
    this.hasErc1820AcceptMagicHex(code) &&
    this.hasErc1820CanImplementInterface(code) &&
    this.hasErc1820GetInterfaceImplementer(code) &&
    this.hasErc1820SetInterfaceImplementer(code) &&
    this.hasErc1820UpdateErc165Cache(code)
  private isErc3668 = (code: string): boolean =>
    code.includes(erc3668MakeSignatureHashSignature) &&
    code.includes(erc3668ResolveWithProofSignature) &&
    code.includes(erc3668NewSignersSignature) &&
    code.includes(erc3668UrlSignature)
  public implementsErc721 = (code: string): boolean => 
    code.includes(transferErc721Signature) &&
    code.includes(approvalErc721Signature) &&
    code.includes(approvalForAllSignature) &&
    code.includes(ownerOfSignature) &&
    code.includes(safeTransferFromBytesSignature) &&
    code.includes(safeTransferFromSignature) &&
    code.includes(transferFromSignature) &&
    code.includes(approveSignature) &&
    code.includes(setApprovalForAll) &&
    code.includes(getApprovedSignature) &&
    code.includes(isApprovedForAll) &&
    code.includes(balanceOfSignature) &&
    code.includes(supportsInterfaceSignature)
}
