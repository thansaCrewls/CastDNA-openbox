const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// ============ KONFIGURASI ============
const CONTRACT_ADDRESS = "0x191C9973880Fc3122Cbf77df007e19254234003D";
const API_BASE = "https://castdna.vercel.app";
const BASE_RPC = process.env.RPC_URL || "https://mainnet.base.org";
const BOX_COUNT = parseInt(process.env.BOX_COUNT) || 50;
const DELAY_MS = parseInt(process.env.DELAY_MS) || 3000;
const DRY_RUN = process.env.DRY_RUN === "true";
const USER_ID = process.env.USER_ID || "";

// ABI: openBox(string) dan openFee()
const ABI = [
  "function openBox(string calldata data)",
  "function openFee() view returns (uint256)"
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Panggil API CastDNA server setelah transaksi on-chain
async function callBoxOpenAPI(userId, txHash) {
  const res = await fetch(`${API_BASE}/api/box-open`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId, txHash }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `API error: ${res.status}`);
  }
  return data;
}

// Cek openFee dari contract
async function getOpenFee(provider) {
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
  try {
    const fee = await contract.openFee();
    return fee;
  } catch {
    return 0n;
  }
}

async function main() {
  // Validasi
  if (!process.env.PRIVATE_KEY) {
    console.error("❌ PRIVATE_KEY belum di-set di file .env");
    console.error("   Copy .env.example ke .env lalu isi private key kamu");
    process.exit(1);
  }

  if (!USER_ID) {
    console.error("❌ USER_ID belum di-set di file .env");
    console.error("   Ini adalah CastDNA user ID kamu (format UUID)");
    console.error("   Contoh: 9c6b1889-0f76-4c30-9c39-2250097059ce");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(BASE_RPC);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

  console.log("========================================");
  console.log("   BATCH OPEN BOX - CastDNA on Base");
  console.log("========================================");
  console.log(`Wallet  : ${wallet.address}`);
  console.log(`User ID : ${USER_ID}`);
  console.log(`Contract: ${CONTRACT_ADDRESS}`);
  console.log(`Jumlah  : ${BOX_COUNT} box`);
  console.log(`Delay   : ${DELAY_MS}ms antar transaksi`);
  if (DRY_RUN) console.log(`⚠️  DRY RUN MODE - tidak akan kirim transaksi`);
  console.log("========================================\n");

  // Cek balance
  const balance = await provider.getBalance(wallet.address);
  console.log(`Balance : ${ethers.formatEther(balance)} ETH`);

  // Cek open fee
  const openFee = await getOpenFee(provider);
  console.log(`Open fee: ${ethers.formatEther(openFee)} ETH per box`);

  // Estimasi total cost
  const estimatedGasPerTx = 35000n;
  const feeData = await provider.getFeeData();
  const gasCostPerTx = estimatedGasPerTx * (feeData.gasPrice || 10000000n);
  const totalCostPerTx = gasCostPerTx + openFee;
  const totalEstimatedCost = totalCostPerTx * BigInt(BOX_COUNT);

  console.log(`Gas cost/tx : ${ethers.formatEther(gasCostPerTx)} ETH`);
  console.log(`Total cost  : ${ethers.formatEther(totalEstimatedCost)} ETH (${BOX_COUNT} boxes)`);

  if (balance < totalEstimatedCost) {
    console.warn("\n⚠️  Balance mungkin tidak cukup untuk semua transaksi!");
  }

  // Test API dulu
  console.log("\n🔍 Testing API connection...");
  try {
    const testRes = await fetch(`${API_BASE}/api/me?userId=${encodeURIComponent(USER_ID)}`);
    const testData = await testRes.json();
    if (testData.user) {
      console.log(`✅ API OK - User: ${testData.user.username || USER_ID}`);
      if (testData.balances) {
        const credits = testData.balances.credits || 0;
        console.log(`   Credits (tickets): ${credits}`);
        if (credits < BOX_COUNT) {
          console.warn(`\n⚠️  Credits (${credits}) kurang dari BOX_COUNT (${BOX_COUNT})!`);
          console.warn(`   Hanya bisa open ${credits} box.`);
        }
      }
    } else {
      console.warn("⚠️  API response tidak mengandung user data");
    }
  } catch (err) {
    console.error(`❌ API test failed: ${err.message}`);
    console.error("   Pastikan USER_ID benar");
    process.exit(1);
  }

  console.log("\n🚀 Memulai batch open box dalam 5 detik...\n");
  await sleep(5000);

  // Ambil nonce awal
  let nonce = await provider.getTransactionCount(wallet.address, "pending");
  let successCount = 0;
  let failCount = 0;
  const results = [];

  for (let i = 0; i < BOX_COUNT; i++) {
    const castDnaString = `castdna:${USER_ID}:${Date.now()}`;

    try {
      console.log(`[${i + 1}/${BOX_COUNT}] Opening box...`);

      if (DRY_RUN) {
        console.log(`  🧪 DRY RUN - Data: ${castDnaString}`);
        successCount++;
        results.push({ index: i + 1, status: "dry-run" });
        continue;
      }

      // STEP 1: Kirim transaksi on-chain
      const callData = contract.interface.encodeFunctionData("openBox", [castDnaString]);
      const tx = await wallet.sendTransaction({
        to: CONTRACT_ADDRESS,
        data: callData,
        value: openFee,
        nonce: nonce,
        gasLimit: estimatedGasPerTx,
        type: 2,
      });

      console.log(`  📤 TX sent: ${tx.hash}`);

      // Tunggu tx confirmed
      const receipt = await tx.wait(1);
      if (!receipt || receipt.status === 0) {
        throw new Error("Transaction reverted on-chain");
      }
      console.log(`  ⛓️  Confirmed in block ${receipt.blockNumber}`);

      // STEP 2: Panggil API server untuk proses box
      const apiResult = await callBoxOpenAPI(USER_ID, tx.hash);
      console.log(`  ✅ Box opened! Reward: ${apiResult.finalReward || apiResult.baseReward || "?"}`);
      if (apiResult.rarity) console.log(`     Rarity: ${apiResult.rarity}`);

      results.push({
        index: i + 1,
        tx: tx.hash,
        reward: apiResult.finalReward || apiResult.baseReward,
        rarity: apiResult.rarity,
        status: "success",
      });
      nonce++;
      successCount++;

      // Delay antar transaksi
      if (i < BOX_COUNT - 1) {
        console.log(`  ⏳ Waiting ${DELAY_MS}ms...\n`);
        await sleep(DELAY_MS);
      }
    } catch (error) {
      const errMsg = error.shortMessage || error.message;
      console.error(`  ❌ Error: ${errMsg}`);
      results.push({ index: i + 1, status: "failed", error: errMsg });
      failCount++;

      // Jika nonce error, refresh
      if (error.message && error.message.includes("nonce")) {
        nonce = await provider.getTransactionCount(wallet.address, "pending");
        console.log(`  🔄 Nonce refreshed: ${nonce}`);
      }

      // Jika transaksi pertama gagal, stop
      if (i === 0) {
        console.error("\n🛑 Transaksi pertama gagal! Berhenti.");
        break;
      }

      await sleep(DELAY_MS);
    }
  }

  // Simpan hasil
  const logFile = path.join(__dirname, "results.json");
  fs.writeFileSync(logFile, JSON.stringify(results, null, 2));

  // Hitung total rewards
  const totalReward = results
    .filter((r) => r.status === "success" && r.reward)
    .reduce((sum, r) => sum + (Number(r.reward) || 0), 0);

  console.log("\n========================================");
  console.log("   SELESAI!");
  console.log("========================================");
  console.log(`✅ Berhasil : ${successCount}`);
  console.log(`❌ Gagal    : ${failCount}`);
  console.log(`📊 Total    : ${BOX_COUNT}`);
  console.log(`🎁 Rewards  : ${totalReward}`);
  console.log(`📁 Log      : results.json`);
  console.log("========================================");
}

main().catch(console.error);
