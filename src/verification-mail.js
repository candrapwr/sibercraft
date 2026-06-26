/**
 * Template email verifikasi. Pure function, mengembalikan { subject, text, html }.
 */
export function buildVerificationEmail({ to, verifyUrl, appName = "SiberCraft", hours = 24 }) {
  const subject = `Verifikasi akun ${appName} Anda`;
  const text = [
    `Halo,`,
    ``,
    `Anda mendaftar akun ${appName}. Klik tautan berikut untuk mengaktifkan akun dan menetapkan kata sandi:`,
    ``,
    verifyUrl,
    ``,
    `Tautan ini berlaku ${hours} jam dan hanya dapat digunakan satu kali.`,
    ``,
    `Jika Anda tidak merasa mendaftar, abaikan email ini.`,
    ``,
    `— ${appName}`,
  ].join("\n");

  const html = `<!doctype html>
<html lang="id">
<head><meta charset="UTF-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f2f4ef;font-family:Inter,ui-sans-serif,system-ui,Arial,sans-serif;color:#18201d;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #d9ded7;border-radius:20px;overflow:hidden;">
        <tr><td style="padding:28px 40px 8px;">
          <span style="font-size:12px;font-weight:700;letter-spacing:.16em;color:#6c766f;">${escapeHtml(appName.toUpperCase())}</span>
        </td></tr>
        <tr><td style="padding:8px 40px 0;">
          <h1 style="margin:0 0 12px;font-size:24px;letter-spacing:-.02em;">Aktifkan akun Anda</h1>
          <p style="margin:0 0 20px;line-height:1.6;color:#4a5550;">
            Terima kasih sudah mendaftar. Tetapkan kata sandi dan aktifkan akun Anda dengan menekan tombol di bawah.
          </p>
        </td></tr>
        <tr><td align="center" style="padding:8px 40px 24px;">
          <a href="${escapeAttr(verifyUrl)}" style="display:inline-block;padding:14px 28px;background:#18221c;color:#ffffff;text-decoration:none;border-radius:12px;font-weight:600;">
            Aktifkan akun
          </a>
        </td></tr>
        <tr><td style="padding:0 40px 20px;">
          <p style="margin:0 0 8px;font-size:13px;color:#657069;">
            Atau salin tautan ini ke browser Anda:
          </p>
          <p style="margin:0 0 20px;word-break:break-all;font-size:13px;color:#18221d;">
            ${escapeHtml(verifyUrl)}
          </p>
        </td></tr>
        <tr><td style="padding:16px 40px 28px;border-top:1px solid #ecefe9;">
          <p style="margin:0;font-size:12px;color:#8a948e;">
            Tautan berlaku ${hours} jam dan hanya dapat digunakan satu kali. Jika Anda tidak merasa mendaftar, abaikan email ini.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { to, subject, text, html };
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function escapeAttr(value) {
  return escapeHtml(value);
}
