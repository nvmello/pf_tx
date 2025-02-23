import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

export const printSOLBalance = async (
  connection: Connection,
  pubkey: PublicKey,
  label: string
) => {
  const balance = await connection.getBalance(pubkey);
  console.log(`${label} SOL Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
};

export const printSPLBalance = async (
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey
) => {
  const { getAssociatedTokenAddress, getAccount } = await import(
    "@solana/spl-token"
  );
  try {
    const ata = await getAssociatedTokenAddress(mint, owner);
    const account = await getAccount(connection, ata);
    console.log(
      `SPL Balance for ${mint.toBase58()}: ${
        Number(account.amount) / 1e6
      } tokens`
    );
  } catch (e) {
    console.log(`No SPL balance found for ${mint.toBase58()}`);
  }
};
