import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { sendMail, close, createTransport } = vi.hoisted(() => ({
  sendMail: vi.fn(),
  close: vi.fn(),
  createTransport: vi.fn(),
}));
vi.mock("nodemailer", () => ({ default: { createTransport } }));
import {
  gmailSender,
  sendGmail,
  smtpError,
  smtpMessageId,
} from "@/lib/mail-transport";
const mail = {
  from: "DogBooker <sender@example.test>",
  to: ["owner@example.test"],
  subject: "Godkänd",
  text: "Luna",
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GMAIL_USER", "sender@example.test");
  vi.stubEnv("GMAIL_APP_PASSWORD", "test pass word");
  createTransport.mockReturnValue({ sendMail, close });
  sendMail.mockResolvedValue({
    accepted: mail.to,
    rejected: [],
    response: "250 2.0.0 OK",
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
it("uses verified TLS, Gmail app password and a stable RFC Message-ID", async () => {
  const id = await sendGmail(mail, "dogbooker/test-job");
  expect(id).toBe(smtpMessageId("dogbooker/test-job", "sender@example.test"));
  expect(createTransport).toHaveBeenCalledWith(
    expect.objectContaining({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      tls: {
        minVersion: "TLSv1.2",
        rejectUnauthorized: true,
        servername: "smtp.gmail.com",
      },
      auth: { user: "sender@example.test", pass: "testpassword" },
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    }),
  );
  expect(sendMail).toHaveBeenCalledWith({
    ...mail,
    messageId: id,
    envelope: { from: "sender@example.test", to: mail.to },
  });
  expect(close).toHaveBeenCalledTimes(1);
});
it.each([
  [{ responseCode: 451, command: "DATA" }, "smtp_retryable_451", false],
  [{ responseCode: 535, code: "EAUTH" }, "smtp_rejected_535", true],
  [{ code: "EDNS", command: "CONN" }, "smtp_retryable_connection", false],
  [
    { code: "ETIMEDOUT", command: "CONN", timeoutType: "CONNECT_TIMEOUT" },
    "smtp_retryable_connection",
    false,
  ],
  [
    { code: "ETIMEDOUT", command: "CONN", timeoutType: "SOCKET_TIMEOUT" },
    "smtp_delivery_uncertain",
    true,
  ],
  [{ code: "ECONNECTION", command: "CONN" }, "smtp_delivery_uncertain", true],
  [{ code: "ESOCKET", command: "DATA" }, "smtp_delivery_uncertain", true],
  [{ code: "ETLS" }, "smtp_configuration_failed", true],
  [{ code: "EAUTH" }, "smtp_configuration_failed", true],
])(
  "classifies SMTP failure %j without leaking raw messages",
  async (error, code, permanent) => {
    sendMail.mockRejectedValue({
      ...error,
      message: "sensitive SMTP reply",
      response: "private credentials",
    });
    await expect(sendGmail(mail, "key")).rejects.toMatchObject({
      code,
      permanent,
      message: code,
    });
    expect(close).toHaveBeenCalledTimes(1);
  },
);
it("bounds an unresponsive send and treats its outcome as uncertain", async () => {
  vi.useFakeTimers();
  sendMail.mockReturnValue(new Promise(() => {}));
  const result = expect(sendGmail(mail, "key")).rejects.toMatchObject({
    code: "smtp_delivery_uncertain",
    permanent: true,
  });
  await vi.advanceTimersByTimeAsync(20000);
  await result;
  expect(close).toHaveBeenCalledTimes(1);
});
it("does not claim acceptance from missing or rejected recipients", async () => {
  sendMail.mockResolvedValue({
    accepted: [],
    rejected: mail.to,
    response: "250 OK",
  });
  await expect(sendGmail(mail, "key")).rejects.toMatchObject({
    code: "smtp_delivery_uncertain",
  });
});
it("fails closed for missing credentials, changed sender and invalid addresses", async () => {
  vi.stubEnv("GMAIL_USER", "attacker\r\n@example.test");
  expect(gmailSender()).toBeUndefined();
  await expect(sendGmail(mail, "key")).rejects.toMatchObject({
    code: "smtp_configuration_failed",
  });
  vi.stubEnv("GMAIL_USER", "different@example.test");
  await expect(sendGmail(mail, "key")).rejects.toMatchObject({
    code: "smtp_configuration_failed",
  });
  vi.stubEnv("GMAIL_USER", "sender@example.test");
  vi.stubEnv("GMAIL_APP_PASSWORD", "");
  await expect(sendGmail(mail, "key")).rejects.toMatchObject({
    code: "smtp_configuration_failed",
  });
  expect(createTransport).not.toHaveBeenCalled();
});
it("unknown failures are never automatically retried", () => {
  expect(smtpError(new Error("private"))).toMatchObject({
    code: "smtp_delivery_uncertain",
    permanent: true,
  });
});
