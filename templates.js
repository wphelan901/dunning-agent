/**
 * templates.js — 4-tier dunning email templates for America's Best Carpet & Tile
 */

const COMPANY = "America's Best Carpet & Tile";
const WEBSITE = 'www.abctflooring.com';
const BILLING_EMAIL = 'billing@abctflooring.com';

/**
 * Fill a template with invoice data
 * @param {string} templateId - 'friendly' | 'formal' | 'warning' | 'final'
 * @param {object} data - { customerName, invoiceNumber, amountRemaining, dueDate, daysOverdue }
 * @returns {{ subject: string, html: string, text: string }}
 */
function buildEmail(templateId, data) {
  const { customerName, invoiceNumber, amountRemaining, dueDate, daysOverdue } = data;
  const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amountRemaining);
  const dueDateFmt = new Date(dueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const templates = {

    // ── Template 1: Friendly Reminder ──────────────────────────────────────
    friendly: {
      subject: `Payment Reminder — Invoice #${invoiceNumber}`,
      text: `Hi ${customerName},

This is a friendly reminder that payment on Invoice #${invoiceNumber} for ${amount} was due on ${dueDateFmt}.

You can pay online at ${WEBSITE}. If the payment has already been sent, please ignore this email.

Thanks,
${COMPANY}`,
      html: layout(`
        <p style="font-size:16px;color:#333;">Hi <strong>${customerName}</strong>,</p>
        <p>This is a friendly reminder that payment on <strong>Invoice #${invoiceNumber}</strong> for <strong>${amount}</strong> was due on ${dueDateFmt}.</p>
        <p>You can pay online at <a href="https://${WEBSITE}" style="color:#c8922a;">${WEBSITE}</a>. If the payment has already been sent, please ignore this email.</p>
        <p style="margin-top:32px;">Thanks,<br><strong>${COMPANY}</strong></p>
      `),
    },

    // ── Template 2: Formal Notice ───────────────────────────────────────────
    formal: {
      subject: `Invoice #${invoiceNumber} — Payment Past Due`,
      text: `Dear ${customerName},

We hope you are doing well. We are writing to let you know that Invoice #${invoiceNumber} for ${amount}, which was due on ${dueDateFmt}, remains outstanding.

We kindly ask that you arrange payment at your earliest convenience. Payment can be made via our website at ${WEBSITE} or through the "Make Payment" link included in your invoice.

If you have already remitted payment, please disregard this notice. Should you have any questions or wish to discuss payment arrangements, please don't hesitate to reach out to us at ${BILLING_EMAIL}.

We value your business and appreciate your prompt attention to this matter.

Best regards,
${COMPANY}
${BILLING_EMAIL}`,
      html: layout(`
        <p style="font-size:16px;color:#333;">Dear <strong>${customerName}</strong>,</p>
        <p>We hope you are doing well. We are writing to let you know that <strong>Invoice #${invoiceNumber}</strong> for <strong>${amount}</strong>, which was due on ${dueDateFmt}, remains outstanding.</p>
        <p>We kindly ask that you arrange payment at your earliest convenience. Payment can be made via our website at <a href="https://${WEBSITE}" style="color:#c8922a;">${WEBSITE}</a> or through the "Make Payment" link included in your invoice.</p>
        <p>If you have already remitted payment, please disregard this notice. Should you have any questions or wish to discuss payment arrangements, please reach out to us at <a href="mailto:${BILLING_EMAIL}" style="color:#c8922a;">${BILLING_EMAIL}</a>.</p>
        <p>We value your business and appreciate your prompt attention to this matter.</p>
        <p style="margin-top:32px;">Best regards,<br><strong>${COMPANY}</strong><br><a href="mailto:${BILLING_EMAIL}" style="color:#c8922a;">${BILLING_EMAIL}</a></p>
      `),
    },

    // ── Template 3: Warning / Service Notice ───────────────────────────────
    warning: {
      subject: `IMPORTANT: Invoice #${invoiceNumber} — ${daysOverdue} Days Past Due`,
      text: `Dear ${customerName},

This is an important notice regarding Invoice #${invoiceNumber} for ${amount}, which is now ${daysOverdue} days past its due date of ${dueDateFmt}.

Despite previous reminders, this balance remains unpaid. We must inform you that continued non-payment may result in a temporary pause or interruption of services until the outstanding balance is resolved.

To avoid any disruption, please submit payment immediately at ${WEBSITE} or contact us at ${BILLING_EMAIL} to make payment arrangements.

If you believe this notice has been sent in error, please contact our billing department right away.

Regards,
${COMPANY}
${BILLING_EMAIL}`,
      html: layout(`
        <div style="background:#fff3cd;border-left:4px solid #e8a435;padding:12px 16px;margin-bottom:24px;border-radius:4px;">
          <strong style="color:#7d5a00;">⚠ Important Notice</strong> — Invoice #${invoiceNumber} is ${daysOverdue} days past due.
        </div>
        <p style="font-size:16px;color:#333;">Dear <strong>${customerName}</strong>,</p>
        <p>Despite previous reminders, <strong>Invoice #${invoiceNumber}</strong> for <strong>${amount}</strong> (due ${dueDateFmt}) remains unpaid.</p>
        <p>We must inform you that continued non-payment may result in a <strong>temporary pause or interruption of services</strong> until the outstanding balance is resolved.</p>
        <p>To avoid any disruption, please submit payment immediately at <a href="https://${WEBSITE}" style="color:#c8922a;">${WEBSITE}</a> or contact us at <a href="mailto:${BILLING_EMAIL}" style="color:#c8922a;">${BILLING_EMAIL}</a> to discuss payment arrangements.</p>
        <p>If you believe this notice has been sent in error, please contact our billing department right away.</p>
        <p style="margin-top:32px;">Regards,<br><strong>${COMPANY}</strong><br><a href="mailto:${BILLING_EMAIL}" style="color:#c8922a;">${BILLING_EMAIL}</a></p>
      `),
    },

    // ── Template 4: Final Demand ────────────────────────────────────────────
    final: {
      subject: `FINAL NOTICE — Invoice #${invoiceNumber} | Immediate Action Required`,
      text: `Dear ${customerName},

This is your final notice regarding Invoice #${invoiceNumber} for ${amount}, which is now ${daysOverdue} days past due.

Despite multiple attempts to resolve this matter, the balance remains unpaid. If full payment is not received within 7 days of this notice, we will have no choice but to refer this account to our collections agency and/or pursue legal remedies to recover the outstanding amount.

To avoid further action, please submit payment immediately at ${WEBSITE} or contact ${BILLING_EMAIL} to discuss resolution.

This notice serves as formal documentation of our final collection attempt.

${COMPANY}
${BILLING_EMAIL}`,
      html: layout(`
        <div style="background:#fde8e8;border-left:4px solid #d94f4f;padding:12px 16px;margin-bottom:24px;border-radius:4px;">
          <strong style="color:#8b1a1a;">⛔ Final Notice</strong> — Immediate action required. Invoice #${invoiceNumber} is ${daysOverdue} days past due.
        </div>
        <p style="font-size:16px;color:#333;">Dear <strong>${customerName}</strong>,</p>
        <p>This is your <strong>final notice</strong> regarding <strong>Invoice #${invoiceNumber}</strong> for <strong>${amount}</strong>, now ${daysOverdue} days past its due date of ${dueDateFmt}.</p>
        <p>Despite multiple attempts to resolve this matter, the balance remains unpaid. If full payment is not received within <strong>7 days of this notice</strong>, we will have no choice but to refer this account to our collections agency and/or pursue legal remedies to recover the outstanding amount.</p>
        <p>To avoid further action, please submit payment immediately at <a href="https://${WEBSITE}" style="color:#c8922a;">${WEBSITE}</a> or contact <a href="mailto:${BILLING_EMAIL}" style="color:#c8922a;">${BILLING_EMAIL}</a>.</p>
        <p style="color:#888;font-size:12px;margin-top:24px;">This notice serves as formal documentation of our final collection attempt.</p>
        <p style="margin-top:32px;"><strong>${COMPANY}</strong><br><a href="mailto:${BILLING_EMAIL}" style="color:#c8922a;">${BILLING_EMAIL}</a></p>
      `),
    },
  };

  const tmpl = templates[templateId];
  if (!tmpl) throw new Error(`Unknown template: ${templateId}`);
  return tmpl;
}

// ── Shared HTML wrapper ──────────────────────────────────────────────────────
function layout(content) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:#1a1a18;padding:24px 36px;">
            <span style="font-family:Georgia,serif;font-size:20px;color:#e8a435;letter-spacing:-0.02em;">
              America's Best Carpet &amp; Tile
            </span>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:36px;color:#333;font-size:15px;line-height:1.7;">
            ${content}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f9f9f9;border-top:1px solid #eee;padding:20px 36px;font-size:12px;color:#999;text-align:center;">
            America's Best Carpet &amp; Tile &nbsp;·&nbsp;
            <a href="https://www.abctflooring.com" style="color:#c8922a;">www.abctflooring.com</a> &nbsp;·&nbsp;
            <a href="mailto:billing@abctflooring.com" style="color:#c8922a;">billing@abctflooring.com</a>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

const TEMPLATE_META = [
  { id: 'friendly',  label: '1 — Friendly Reminder',        color: '#4caf82', description: 'Gentle, warm tone. Best for first contact.' },
  { id: 'formal',    label: '2 — Formal Notice',            color: '#5b8dee', description: 'Professional and firm. Good for 45–59 day accounts.' },
  { id: 'warning',   label: '3 — Warning / Service Notice', color: '#e8a435', description: 'Strict notice mentioning potential service disruption.' },
  { id: 'final',     label: '4 — Final Demand',             color: '#d94f4f', description: 'Last notice before collections or legal action.' },
];

module.exports = { buildEmail, TEMPLATE_META };
