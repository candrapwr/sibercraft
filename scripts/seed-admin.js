#!/usr/bin/env node
/**
 * seed-admin.js — Bootstrap akun admin langsung ke database (tanpa email verifikasi).
 *
 * Penggunaan:
 *   npm run seed:admin -- admin@example.com
 *   npm run seed:admin -- admin@example.com --reset   # ubah password akun yang sudah ada
 *
 * Password diminta secara interaktif (tersembunyi). Akun dibuat dengan:
 *   role = admin, status = active, password di-hash dengan scrypt.
 *
 * Aman untuk production bootstrap. Jalankan di server tempat .env & data/ berada.
 */
import { config } from "../src/config.js";
import { initDb } from "../src/db.js";
import { UserStore, normalizeEmail } from "../src/auth-store.js";
import { hashPassword } from "../src/password.js";
import { createInterface } from "node:readline";
import { writeFileSync, existsSync } from "node:fs";

function parseArgs(argv) {
  const args = argv.slice(2);
  const reset = args.includes("--reset");
  const positional = args.filter((a) => !a.startsWith("--"));
  const email = positional[0];
  return { email, reset };
}

function ask(question, { secret = false } = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    if (secret) {
      // Sembunyikan input password.
      const onData = (char) => {
        const c = char.toString();
        if (c === "\r" || c === "\n" || c === "\u0004") {
          rl.input.removeListener("data", onData);
          process.stdout.write("\n");
          return;
        }
        // Hapus karakter yg diketik, ganti tanda bintang.
        process.stdout.write("\b \b" + "*");
      };
      rl.input.on("data", onData);
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

async function main() {
  const { email: rawEmail, reset } = parseArgs(process.argv);

  if (!rawEmail) {
    console.error("Penggunaan: npm run seed:admin -- <email> [--reset]");
    console.error("Contoh:  npm run seed:admin -- admin@idsiber.com");
    process.exit(1);
  }

  const email = normalizeEmail(rawEmail);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error(`Email tidak valid: ${rawEmail}`);
    process.exit(1);
  }

  // Pastikan .env ada (peringatan bila belum).
  if (!existsSync(".env")) {
    console.warn("⚠ File .env tidak ditemukan. Memakai default / environment variable.");
    console.warn("  Pastikan SESSION_SECRET & MAIL_* sudah diatur di production.");
  }

  console.log(`\nSeed admin akun ke database: ${config.dataDir}/app.db`);
  console.log(`Email: ${email}`);
  console.log(`Mode: ${reset ? "RESET PASSWORD" : "BUAT BARU / UPSERT"}\n`);

  // Password bisa lewat env SEED_PASSWORD (untuk automasi) atau prompt interaktif.
  const envPassword = process.env.SEED_PASSWORD;
  let password;
  if (envPassword) {
    password = envPassword;
    console.log("(password dari env SEED_PASSWORD)");
  } else if (!process.stdin.isTTY) {
    console.error("✗ Stdin bukan TTY. Set password via env: SEED_PASSWORD=... npm run seed:admin -- " + email);
    process.exit(1);
  } else {
    password = await ask("Password (min. 8 karakter): ", { secret: true });
    if (password.length < config.auth.passwordMinLength) {
      console.error(`\n✗ Password minimal ${config.auth.passwordMinLength} karakter.`);
      process.exit(1);
    }
    const confirm = await ask("Ulangi password: ", { secret: true });
    if (password !== confirm) {
      console.error("\n✗ Password tidak cocok.");
      process.exit(1);
    }
  }
  if (password.length < config.auth.passwordMinLength) {
    console.error(`\n✗ Password minimal ${config.auth.passwordMinLength} karakter.`);
    process.exit(1);
  }

  console.log("\nMenghash password (scrypt)...");
  const passwordHash = await hashPassword(password);

  const db = await initDb(config.dataDir);
  const store = new UserStore(db);

  const existing = await store.findByEmail(email);
  // Tentukan role: admin bila terdaftar di ADMIN_EMAILS, atau paksa admin (ini script admin).
  const role = "admin";

  if (existing) {
    if (!reset) {
      console.log(`\n⚠ Akun ${email} sudah ada (role: ${existing.role}, status: ${existing.status}).`);
      console.log("  Untuk mengubah password, jalankan dengan flag --reset.");
      console.log(`  Skipped. Tidak ada perubahan.`);
      db.close();
      process.exit(0);
    }
    await store.setPassword(existing.id, passwordHash);
    // Pastikan role admin & status active.
    await store.updateUser(existing.id, { role });
    console.log(`\n✓ Password akun ${email} diubah. Role: admin, status: active.`);
  } else {
    // Buat user baru langsung aktif dengan password.
    const uid = cryptoRandomUuid();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO users (id, email, password_hash, role, tier, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(uid, email, passwordHash, role, "free", now, now);
    console.log(`\n✓ Akun admin ${email} dibuat. Role: admin, tier: free, status: active.`);
  }

  // Saran: tambahkan email ke ADMIN_EMAILS bila belum.
  if (!config.auth.adminEmails.has(email)) {
    console.log(`\n⚠ Catatan: ${email} belum tercantum di ADMIN_EMAILS (.env).`);
    console.log("  Tambahkan agar email ini tetap dianggap admin saat register ulang:");
    console.log(`  ADMIN_EMAILS=${email}`);
  }

  db.close();
  console.log("\nSelesai. Anda dapat login sekarang.\n");
}

function cryptoRandomUuid() {
  return globalThis.crypto.randomUUID();
}

main().catch((error) => {
  console.error("\n✗ Gagal:", error.message);
  process.exit(1);
});
