const { Web3 } = require('web3');
const axios = require('axios');

const ERC721_ABI = [
  {
    constant: true,
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    name: 'tokenURI',
    outputs: [{ name: '', type: 'string' }],
    type: 'function'
  },
  {
    constant: true,
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    name: 'ownerOf',
    outputs: [{ name: '', type: 'address' }],
    type: 'function'
  },
  {
    constant: true,
    inputs: [],
    name: 'totalSupply',
    outputs: [{ name: '', type: 'uint256' }],
    type: 'function'
  },
  {
    constant: true,
    inputs: [],
    name: 'name',
    outputs: [{ name: '', type: 'string' }],
    type: 'function'
  }
];

class NFTService {
  constructor(rpcUrl, contractAddress) {
    this.web3 = new Web3(rpcUrl);
    this.contractAddress = contractAddress;
    this.contract = new this.web3.eth.Contract(ERC721_ABI, contractAddress);
  }

  async getCollectionName() {
    try {
      const name = await this.contract.methods.name().call();
      return name;
    } catch (error) {
      console.error('Error getting collection name:', error.message);
      return 'NFT Collection';
    }
  }

  async getNFTMetadata(tokenId) {
    try {
      const tokenURI = await this.contract.methods.tokenURI(tokenId).call();

      let metadataUrl = tokenURI;
      if (tokenURI.startsWith('ipfs://')) {
        metadataUrl = tokenURI.replace('ipfs://', 'https://gateway.pinata.cloud/ipfs/');
      }

      const response = await axios.get(metadataUrl, { timeout: 10000 });
      let metadata = response.data;

      if (typeof metadata === 'string') {
        metadata = JSON.parse(metadata);
      }

      if (metadata.image && metadata.image.startsWith('ipfs://')) {
        const ipfsHash = metadata.image.replace('ipfs://', '');
        metadata.image = `https://gateway.pinata.cloud/ipfs/${ipfsHash}`;
      }

      let attributes = metadata.attributes || metadata.properties || [];

      if (!Array.isArray(attributes)) {
        attributes = [];
      }

      const rarityScore = this.calculateRarityScore(attributes);

      const nftData = {
        tokenId,
        name: metadata.name || `#${tokenId}`,
        description: metadata.description || '',
        image: metadata.image || '',
        attributes: attributes,
        rarityScore: rarityScore
      };

      console.log(`Token ${tokenId} metadata:`, JSON.stringify(nftData, null, 2));

      return nftData;
    } catch (error) {
      console.error(`Error getting metadata for token ${tokenId}:`, error.message);
      throw new Error(`Unable to fetch NFT #${tokenId}. It may not exist or metadata is unavailable.`);
    }
  }

  calculateRarityScore(attributes) {
    if (!Array.isArray(attributes) || attributes.length === 0) {
      return 0;
    }

    let score = 0;
    attributes.forEach(attr => {
      if (attr.value) {
        score += 5;
      }
    });

    score += attributes.length * 2;
    return Math.round(score);
  }

  formatTraits(attributes) {
    if (!Array.isArray(attributes) || attributes.length === 0) {
      return 'Not available';
    }

    const traits = attributes
      .map(attr => {
        const trait = attr.trait_type || attr.name || 'Unknown';
        const value = attr.value || 'Unknown';
        return `• ${trait}: ${value}`;
      })
      .filter(line => line);

    return traits.length > 0 ? traits.join('\n') : 'Not available';
  }

  async getRandomNFT(maxSupply) {
    const randomTokenId = Math.floor(Math.random() * maxSupply);
    return this.getNFTMetadata(randomTokenId);
  }

  async getNFTById(tokenId) {
    return this.getNFTMetadata(tokenId);
  }

  async getHolderAddress(tokenId) {
    try {
      const holder = await this.contract.methods.ownerOf(tokenId).call();
      return holder;
    } catch (error) {
      console.error(`Error getting holder for token ${tokenId}:`, error.message);
      return null;
    }
  }

  getExplorerUrl(tokenId) {
    return `https://bscscan.com/token/${this.contractAddress}?a=${tokenId}`;
  }

  getShortAddress(address) {
    if (!address || address.length < 8) return address;
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  }
}

module.exports = NFTService;
