import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
async function run() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  // Random Devnet address
  const pubkey = new PublicKey('11111111111111111111111111111111');
  console.log('Requesting airdrop...');
  try {
    const signature = await connection.requestAirdrop(pubkey, 1 * LAMPORTS_PER_SOL);
    console.log('Airdrop signature:', signature);
    const latestBlockhash = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature, ...latestBlockhash });
    console.log('Confirmed!');
  } catch (e: any) {
    console.error('Error:', e.message);
  }
}
run();
