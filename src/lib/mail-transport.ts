import { createHash } from "node:crypto";
import nodemailer from "nodemailer";

export type Mail = {
  from: string;
  to: string[];
  subject: string;
  text: string;
};
export type SendMail = (mail: Mail, key: string) => Promise<string>;
export class DeliveryError extends Error {
  constructor(
    public code: string,
    public permanent = true,
  ) {
    super(code);
  }
}
export function gmailSender() {
  const user = process.env.GMAIL_USER?.trim();
  if (!user || !/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(user)) return undefined;
  return { user, from: `DogBooker <${user}>` };
}
export function smtpMessageId(key: string, sender: string) {
  return `<dogbooker-${createHash("sha256").update(key).digest("hex")}@${sender.split("@")[1]}>`;
}
/** SMTP has no idempotency protocol. Only definite non-delivery is safe to retry. */
export function smtpError(error: unknown): DeliveryError {
  if (error instanceof DeliveryError) return error;
  const e = error as {
    code?: string;
    command?: string;
    responseCode?: number;
    timeoutType?: string;
  } | null;
  const status = e?.responseCode;
  if (status && status >= 400 && status < 500)
    return new DeliveryError(`smtp_retryable_${status}`, false);
  if (status && status >= 500 && status < 600)
    return new DeliveryError(`smtp_rejected_${status}`);
  if (
    ["EAUTH", "ENOAUTH", "ECONFIG", "ETLS", "EREQUIRETLS"].includes(
      e?.code ?? "",
    )
  )
    return new DeliveryError("smtp_configuration_failed");
  // Generic CONN/socket failures may occur after DATA; never infer non-delivery from
  // that command alone. Only known pre-submission phases are safe. A socket failure
  // during DATA or an unknown stage may follow acceptance: require reconciliation.
  if (
    e?.code === "EDNS" ||
    ["CONNECT_TIMEOUT", "GREETING_TIMEOUT", "UPGRADE_TIMEOUT"].includes(
      e?.timeoutType ?? "",
    ) ||
    /^(EHLO|HELO|STARTTLS|AUTH(?: .*)?|MAIL FROM|RCPT TO)$/.test(
      e?.command ?? "",
    )
  )
    return new DeliveryError("smtp_retryable_connection", false);
  return new DeliveryError("smtp_delivery_uncertain");
}
export async function sendGmail(mail: Mail, key: string): Promise<string> {
  const sender = gmailSender();
  const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, "");
  if (!sender || !pass || mail.from !== sender.from || mail.to.length !== 1)
    throw new DeliveryError("smtp_configuration_failed");
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: sender.user, pass },
    tls: {
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
      servername: "smtp.gmail.com",
    },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    dnsTimeout: 5000,
    socketTimeout: 10000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  const messageId = smtpMessageId(key, sender.user);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      transporter.sendMail({
        ...mail,
        messageId,
        envelope: { from: sender.user, to: mail.to },
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new DeliveryError("smtp_delivery_uncertain")),
          20000,
        );
      }),
    ]);
    if (
      result.accepted.length !== 1 ||
      result.rejected.length ||
      !/^250\b/.test(result.response)
    )
      throw new DeliveryError("smtp_delivery_uncertain");
    return messageId;
  } catch (error) {
    throw smtpError(error);
  } finally {
    clearTimeout(timer);
    transporter.close();
  }
}
