
const nodemailer = require('nodemailer');

let transporter;

// Gmail SMTP for local development
function getTransporter() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error('SMTP credentials are missing.');
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000
    });
  }

  return transporter;
}

async function sendMail({ to, subject, text, html }) {

  // Production: use Brevo HTTPS API
  if (process.env.BREVO_API_KEY) {
    if (!process.env.MAIL_FROM) {
      throw new Error('MAIL_FROM is missing.');
    }

    const payload = {
      sender: {
        name: 'KravN',
        email: process.env.MAIL_FROM
      },
      to: [{ email: to }],
      subject,
      ...(html
        ? { htmlContent: html }
        : { textContent: text || '' })
    };

    const response = await fetch(
      'https://api.brevo.com/v3/smtp/email',
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'api-key': process.env.BREVO_API_KEY,
          'content-type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000)
      }
    );

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(
        `Brevo API failed (${response.status}): ${responseText.slice(0, 500)}`
      );
    }

    console.log('KravN email accepted by Brevo');

    return responseText ? JSON.parse(responseText) : null;
  }

  // Local development: use Gmail SMTP
  return getTransporter().sendMail({
    from: `"KravN" <${process.env.SMTP_USER}>`,
    to,
    subject,
    text,
    html
  });
}

module.exports = { sendMail };
