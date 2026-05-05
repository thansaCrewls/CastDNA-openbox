const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// ============ KONFIGURASI ============
const CONTRACT_ADDRESS = "0x191C9973880Fc3122Cbf77df007e19254234003D";
const API_BASE = "https://castdna.vercel.app";
const BASE_RPC = process.env.RPC_URL || "https://mainnet.base.org";
const BOX_COUNT = parseInt(process.env.BOX_COUNT) || 47;
const USER_ID = process.env.USER_ID || "";

const ABI = [
  "function openBox(string calldata data)",
  "function openFee() view returns (uint256)"
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callBoxOpenAPI(userId, txHash) {
  const res = await fetch(`${API_BASE}/api/box-open`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId, txHash }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `API error: ${res.status}`);
  return data;
}

async function getOpenFee(provider) {
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
  try {
    return await contract.openFee();
  } catch {
    return 0n;
  }
}

async function main() {
  if (!process.env.PRIVATE_KEY) {
    console.error("❌ PRIVATE_KEY belum di-set di file .env");
    process.exit(1);
  }
  if (!USER_ID) {
    console.error("❌ USER_ID belum di-set di file .env");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(BASE_RPC);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

  console.log("========================================");
  console.log("  ⚡ BLAST MODE - Open All Boxes Fast");
  console.log("========================================");
  console.log(`Wallet  : ${wallet.address}`);
  console.log(`User ID : ${USER_ID}`);
  console.log(`Boxes   : ${BOX_COUNT}`);
  console.log("========================================\n");

  // Cek balance & fee
  const balance = await provider.getBalance(wallet.address);
  const openFee = await getOpenFee(provider);
  console.log(`Balance  : ${ethers.formatEther(balance)} ETH`);
  console.log(`Open fee : ${ethers.formatEther(openFee)} ETH/box`);

  // Cek credits
  const meRes = await fetch(`${API_BASE}/api/me?userId=${encodeURIComponent(USER_ID)}`);
  const meData = await meRes.json();
  const credits = meData.balances?.credits || 0;
  console.log(`Credits  : ${credits}`);

  if (credits === 0) {
    console.error("\n❌ Tidak ada credits! Tidak bisa open box.");
    process.exit(1);
  }

  const actualCount = Math.min(BOX_COUNT, credits);
  if (actualCount < BOX_COUNT) {
    console.warn(`\n⚠️  Hanya open ${actualCount} box (credits tersedia)`);
  }

  const totalCost = openFee * BigInt(actualCount);
  console.log(`Total fee: ${ethers.formatEther(totalCost)} ETH`);

  if (balance < totalCost + BigInt(actualCount) * 35000n * 10000000n) {
    console.error("\n❌ Balance tidak cukup!");
    process.exit(1);
  }

  console.log(`\n🚀 BLAST: Mengirim ${actualCount} transaksi sekaligus dalam 5 detik...\n`);
  await sleep(5000);

  // ===== PHASE 1: Kirim SEMUA transaksi sekaligus =====
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  PHASE 1: Sending all transactions...");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  let nonce = await provider.getTransactionCount(wallet.address, "pending");
  const pendingTxs = [];

  for (let i = 0; i < actualCount; i++) {
    const castDnaString = `castdna:${USER_ID}:${Date.now()}`;
    const callData = contract.interface.encodeFunctionData("openBox", [castDnaString]);

    try {
      const tx = await wallet.sendTransaction({
        to: CONTRACT_ADDRESS,
        data: callData,
        value: openFee,
        nonce: nonce,
        gasLimit: 35000n,
        type: 2,
      });

      pendingTxs.push({ index: i + 1, tx, castDnaString });
      console.log(`  [${i + 1}/${actualCount}] Sent: ${tx.hash.slice(0, 18)}... (nonce: ${nonce})`);
      nonce++;
      // Delay agar RPC tidak rate-limit
      await sleep(500);
    } catch (error) {
      console.error(`  [${i + 1}] ❌ Send failed: ${error.shortMessage || error.message}`);
      // Tunggu lalu refresh nonce dan coba lanjut
      await sleep(2000);
      try {
        nonce = await provider.getTransactionCount(wallet.address, "pending");
        console.log(`  🔄 Nonce refreshed: ${nonce}, retrying...`);
        i--; // retry index yang sama
      } catch {
        console.error("  🛑 Cannot recover, stopping sends.");
        break;
      }
    }
  }

  console.log(`\n📤 ${pendingTxs.length}/${actualCount} transaksi terkirim!`);

  if (pendingTxs.length === 0) {
    console.error("❌ Tidak ada transaksi yang berhasil dikirim.");
    process.exit(1);
  }

  // ===== PHASE 2: Tunggu semua transaksi confirmed (batch 5) =====
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  PHASE 2: Waiting for confirmations...");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Tunggu dulu beberapa detik agar tx masuk block
  console.log("  ⏳ Waiting 5s for txs to be mined...");
  await sleep(5000);

  const confirmedTxs = [];
  const BATCH_SIZE = 5;

  for (let i = 0; i < pendingTxs.length; i += BATCH_SIZE) {
    const batch = pendingTxs.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async ({ index, tx }) => {
        const receipt = await tx.wait(1);
        return { index, tx, receipt };
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        const { index, tx, receipt } = result.value;
        if (receipt && receipt.status === 1) {
          confirmedTxs.push({ index, txHash: tx.hash });
          console.log(`  [${index}] ✅ Confirmed (block ${receipt.blockNumber})`);
        } else {
          console.log(`  [${index}] ❌ Reverted`);
        }
      } else {
        console.log(`  ❌ Wait failed: ${result.reason?.message?.slice(0, 60)}`);
      }
    }
    // Delay antar batch agar tidak rate-limited
    if (i + BATCH_SIZE < pendingTxs.length) await sleep(1000);
  }

  console.log(`\n⛓️  ${confirmedTxs.length}/${pendingTxs.length} confirmed!`);

  // ===== PHASE 3: Panggil API untuk semua tx =====
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  PHASE 3: Claiming rewards from API...");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const results = [];
  let totalReward = 0;

  for (const { index, txHash } of confirmedTxs) {
    try {
      const apiResult = await callBoxOpenAPI(USER_ID, txHash);
      const reward = apiResult.finalReward || apiResult.baseReward || 0;
      totalReward += Number(reward);
      results.push({ index, txHash, reward, rarity: apiResult.rarity, status: "success" });
      console.log(`  [${index}] 🎁 Reward: ${reward} ${apiResult.rarity ? `(${apiResult.rarity})` : ""}`);
    } catch (error) {
      results.push({ index, txHash, status: "api_failed", error: error.message });
      console.error(`  [${index}] ❌ API: ${error.message}`);
    }
    // Sedikit delay agar tidak di-rate-limit
    await sleep(500);
  }

  // Simpan hasil
  const logFile = path.join(__dirname, "blast-results.json");
  fs.writeFileSync(logFile, JSON.stringify(results, null, 2));

  const successCount = results.filter((r) => r.status === "success").length;

  console.log("\n========================================");
  console.log("  ⚡ BLAST SELESAI!");
  console.log("========================================");
  console.log(`✅ Berhasil    : ${successCount}/${actualCount}`);
  console.log(`🎁 Total Reward: ${totalReward}`);
  console.log(`📁 Log         : blast-results.json`);
  console.log("========================================");
}

main().catch(console.error);
