# Batch Open Box - CastDNA on Base

Script untuk mengirim banyak transaksi "open box" secara otomatis ke contract CastDNA di Base chain.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` ke `.env`:
   ```bash
   copy .env.example .env
   ```

3. Edit `.env` dan isi `PRIVATE_KEY` dengan private key wallet kamu.

## Konfigurasi (.env)

| Variable | Deskripsi | Default |
|----------|-----------|---------|
| `PRIVATE_KEY` | Private key wallet (WAJIB) | - |
| `BOX_COUNT` | Jumlah box yang mau di-open | 50 |
| `DELAY_MS` | Delay antar transaksi (ms) | 2000 |
| `RPC_URL` | Base RPC endpoint | https://mainnet.base.org |
Cara ambil USER_ID = coba 1x tx open box
buka basescan tx ahshnya, dibagian input data view input as UTF-8
ambil string setelah castdna: dan sebelum :timestamp


## Jalankan

```bash
npm start
```

## ⚠️ Peringatan Keamanan

- **JANGAN** share file `.env` ke siapapun
- **JANGAN** commit file `.env` ke git
- Private key memberikan akses penuh ke wallet kamu
- Test dulu dengan `BOX_COUNT=1` sebelum menjalankan banyak transaksi
