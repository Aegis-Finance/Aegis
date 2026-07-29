
import { ethers } from 'ethers';

// The private key provided by the user
const privateKey = '0xbd8009df8164ca36a4e4919ea2425a8745660b51a503454d1a3e5240195dfb10';
const provider = new ethers.JsonRpcProvider('https://arbitrum.llamarpc.com');

async function main() {
  try {
    const wallet = new ethers.Wallet(privateKey, provider);
    console.log(`Address: ${wallet.address}`);
    
    const balance = await provider.getBalance(wallet.address);
    console.log(`Balance: ${ethers.formatEther(balance)} ETH`);
    
    // Check if balance is enough for roughly $5-10 (at $2500/ETH, $10 is ~0.004 ETH)
    // 0.004 ETH
    
  } catch (error) {
    console.error('Error checking balance:', error);
  }
}

main();
