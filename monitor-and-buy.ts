import dotenv from "dotenv";
import bs58 from "bs58";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import { PumpFunSDK, GlobalAccount } from "pumpdotfun-sdk";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { printSOLBalance, printSPLBalance } from "./util";

dotenv.config();

// Configuration
const TARGET_WALLETS = new Set([
  "5rkPDK4JnVAumgzeV2Zu8vjggMTtHdDtrsd5o9dhGZHD", // Wallet 1
  "Guo8RUaui9uYzT49HEB1tfacQEYYA8v2qRL8uZnMaMAG", // Wallet 2
  "99KorR2TqEFSvMJ4UQmxbXRBB5q2GioLLGhjE3nZ2gjq",
  "CfF2ETryzDx85YtJUtt1NpqBJtw2f3S5kDNDp7TXdySC",
  "3apupKwTisjy4Wx1zVndXVegmxtR9majPEgHatBRZ1LF",
]); // Set of wallets to monitor
const SLIPPAGE_BASIS_POINTS = 7000n; // 70% slippage
const BUY_AMOUNT_SOL = BigInt(2 * LAMPORTS_PER_SOL); // Amount to spend (e.g., 2 SOL)

// Replace with your private key (base58 string or JSON array)
const PRIVATE_KEY = process.env.PRIVATE_KEY || "your-base58-private-key-here";

// Load the buyer keypair from the private key
const loadBuyerKeypair = (): Keypair => {
  try {
    if (!PRIVATE_KEY) {
      throw new Error(
        "Private key not provided. Set PRIVATE_KEY in .env file."
      );
    }

    if (typeof PRIVATE_KEY !== "string") {
      throw new Error("Private key must be a base58-encoded string.");
    }

    const secretKey = Uint8Array.from(bs58.decode(PRIVATE_KEY));
    return Keypair.fromSecretKey(secretKey);
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`Failed to load private key: ${error.message}`);
    }
    throw new Error("Failed to load private key: Unknown error occurred");
  }
};

// Set up Solana provider
const getProvider = (buyerKeypair: Keypair) => {
  if (!process.env.HELIUS_RPC_URL) {
    throw new Error("Please set HELIUS_RPC_URL in .env file");
  }

  const connection = new Connection(
    process.env.HELIUS_RPC_URL || "",
    "confirmed"
  );

  // Create a wallet object
  const wallet: Wallet = {
    publicKey: buyerKeypair.publicKey,
    signTransaction: async (transaction: any) => {
      transaction.sign(buyerKeypair);
      return transaction;
    },
    signAllTransactions: async (transactions: any[]) => {
      transactions.forEach((transaction) => transaction.sign(buyerKeypair));
      return transactions;
    },
    payer: buyerKeypair, // Add the payer property
  };

  return new AnchorProvider(connection, wallet, { commitment: "finalized" });
};

// Check if the bonding curve account exists
const checkBondingCurveAccountExists = async (
  sdk: PumpFunSDK,
  mint: PublicKey
) => {
  try {
    const bondingCurveAccount = await sdk.getBondingCurveAccount(mint);
    return bondingCurveAccount !== null;
  } catch (error) {
    return false;
  }
};

// Function to buy tokens
const buyToken = async (
  sdk: PumpFunSDK,
  buyer: Keypair,
  mint: PublicKey,
  eventId: number
) => {
  console.log(`Attempting to buy token: ${mint.toBase58()}`);

  try {
    // Wait for bonding curve account to be initialized
    let bondingCurveAccountExists = false;
    let retries = 0;
    const maxRetries = 1000; // Reduced retries for speed (adjust as needed)
    const retryDelay = 50; // Reduced delay to 0.05s for faster polling

    while (!bondingCurveAccountExists && retries < maxRetries) {
      bondingCurveAccountExists = await checkBondingCurveAccountExists(
        sdk,
        mint
      );
      if (!bondingCurveAccountExists) {
        retries++;
        console.log(
          `Bonding curve account not found. Retrying in ${
            retryDelay / 1000
          } seconds... (${retries}/${maxRetries})`
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }

    if (!bondingCurveAccountExists) {
      throw new Error(
        `Bonding curve account not found after ${maxRetries} retries`
      );
    }

    console.log("Bonding curve account found. Proceeding with purchase...");

    // // Optimized priority fees for speed
    // const priorityFees = {
    //   unitLimit: 250000, // 250,000 compute units
    //   unitPrice: 50000000, // 50,000,000 microLamports per compute unit (50 SOL per million CU)
    // };

    // Use SDK's buy method directly with priority fees
    const buyResults = await sdk.buy(
      buyer,
      mint,
      BUY_AMOUNT_SOL, // 2 SOL
      SLIPPAGE_BASIS_POINTS // 70% slippage
      // priorityFees, // Pass optimized priority fees
      // "processed", // Use 'processed' commitment for speed (faster than 'confirmed')
      // "finalized" // Finality remains 'finalized' for reliability
    );

    if (buyResults.success) {
      console.log(
        `Transaction successful: https://solscan.io/tx/${buyResults.signature}`
      );
      await printSPLBalance(sdk.connection, mint, buyer.publicKey);
      console.log("Purchase successful. Shutting down...");
      sdk.removeEventListener(eventId);
      process.exit(0);
    } else {
      throw new Error("Buy transaction failed");
    }
  } catch (error) {
    console.error("An error occurred during purchase:", error);
  }
};

// Main monitoring function
const monitorWallet = async () => {
  try {
    const buyerKeypair = loadBuyerKeypair();
    console.log(`Using buyer wallet: ${buyerKeypair.publicKey.toBase58()}`);

    const provider = getProvider(buyerKeypair);
    const sdk = new PumpFunSDK(provider);

    const buyerBalance = await sdk.connection.getBalance(
      buyerKeypair.publicKey
    );
    if (buyerBalance < 0.004 * LAMPORTS_PER_SOL) {
      console.log(
        `Insufficient funds in buyer wallet: ${buyerKeypair.publicKey.toBase58()}`
      );
      console.log("Please fund the wallet with at least 0.004 SOL.");
      return;
    }
    await printSOLBalance(
      sdk.connection,
      buyerKeypair.publicKey,
      "Buyer Wallet"
    );

    const createEventId = sdk.addEventListener(
      "createEvent",
      async (event, slot, signature) => {
        const creator = new PublicKey(event.user);
        const mint = new PublicKey(event.mint);

        // Check if the creator is in the set of target wallets
        if (TARGET_WALLETS.has(creator.toBase58())) {
          console.log(
            `New token detected from target wallet: ${creator.toBase58()}`
          );
          console.log(
            `Token Mint: ${mint.toBase58()}, Slot: ${slot}, Signature: ${signature}`
          );
          await buyToken(sdk, buyerKeypair, mint, createEventId);
        }
      }
    );

    console.log(
      `Monitoring wallets: ${Array.from(TARGET_WALLETS).join(
        "\n, "
      )} for new token launches...`
    );
    console.log(`Event listener subscribed with ID: ${createEventId}`);

    process.on("SIGINT", () => {
      console.log("Shutting down manually...");
      sdk.removeEventListener(createEventId);
      process.exit(0);
    });
  } catch (error) {
    console.error("An error occurred:", error);
  }
};

monitorWallet();
