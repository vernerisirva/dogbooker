import {
  gmailSender,
  sendGmail,
  DeliveryError,
  type SendMail,
  type Mail,
} from "./mail-transport";
export { DeliveryError } from "./mail-transport";
export type { SendMail } from "./mail-transport";
import { isReminderEvent, type ReminderEvent } from "./reminder-policy";
import { lockReminderForDelivery } from "./reminder-service";
import type { PoolClient } from "pg";
import { pool } from "@/db";
import {
  notificationContent,
  type NotificationEvent,
  type NotificationPayload,
} from "./notification-content";

/** Called inside the booking transaction. No network side effects before commit. */
export async function enqueueNotification(
  c: PoolClient,
  bookingId: string,
  event: NotificationEvent,
  change?: {
    version: number;
    previousArrivalTime: string | null;
    previousPickupTime?: string | null;
    proposedArrivalTime?: string | null;
    proposedPickupTime?: string | null;
  },
  reminderDate?: string,
) {
  const result = await c.query(
    `INSERT INTO notification_jobs(booking_id,event,event_version,recipient_id,recipient_email,payload)
    SELECT e.id,$2,$3,r.id,r.email,jsonb_build_object('dogName',o.dog_name,'startDate',e.start_date::text,'endDate',e.end_date::text,'status',e.booking_status,'arrivalTime',left(e.arrival_time::text,5),'previousArrivalTime',$4::text,'pickupTime',left(e.pickup_time::text,5),'previousPickupTime',$5::text,'proposedArrivalTime',$6::text,'proposedPickupTime',$7::text,'reminderDate',$8::text)
    FROM entries e JOIN users o ON o.id=e.owner_id
    JOIN users r ON CASE WHEN $2 IN ('requested','owner_cancelled','arrival_changed','times_changed','time_change_requested','time_change_accepted','time_change_rejected') THEN r.role='admin' ELSE r.id=e.owner_id END
    WHERE e.id=$1 ON CONFLICT(booking_id,event,event_version) DO UPDATE SET
    state='pending',available_at=now(),last_error=NULL,payload=EXCLUDED.payload,
    recipient_id=EXCLUDED.recipient_id,recipient_email=EXCLUDED.recipient_email
    WHERE notification_jobs.event IN ('dropoff_reminder','pickup_reminder') AND notification_jobs.state='skipped'
    AND notification_jobs.attempts=0 AND notification_jobs.payload->>'reminderDate' IS DISTINCT FROM EXCLUDED.payload->>'reminderDate' `,
    [
      bookingId,
      event,
      change?.version ?? 0,
      change?.previousArrivalTime ?? null,
      change?.previousPickupTime ?? null,
      change?.proposedArrivalTime ?? null,
      change?.proposedPickupTime ?? null,
      reminderDate ?? null,
    ],
  );
  return result.rowCount ?? 0;
}

/** Transactional outbox: one lease at a time. SMTP cannot deduplicate an uncertain
 * send, so expired in-flight attempts and ambiguous outcomes are held for review.
 */
export async function deliverNotifications(
  options: {
    send?: SendMail;
    limit?: number;
    reminderEvent?: ReminderEvent;
    now?: Date;
  } = {},
) {
  const from = gmailSender()?.from;
  const origin = process.env.BETTER_AUTH_URL;
  if (
    !from ||
    !origin ||
    (!options.send && !process.env.GMAIL_APP_PASSWORD?.trim())
  )
    return { configured: false, sent: 0 };
  const send = options.send ?? sendGmail;
  const limit = Math.max(0, Math.min(options.limit ?? 2, 2));
  let sent = 0;
  for (let i = 0; i < limit; i++) {
    const {
      rows: [job],
    } = await pool.query(
      `WITH candidate AS (
      SELECT id,state FROM notification_jobs WHERE event IN ('requested','approved','declined','owner_cancelled','admin_cancelled','arrival_changed','times_changed','time_change_requested','time_change_approved','time_change_declined','time_change_proposed','time_change_accepted','time_change_rejected','time_change_direct','dropoff_reminder','pickup_reminder') AND ($1::text IS NULL OR event=$1) AND ((state='pending' AND available_at<=now()) OR (state='sending' AND locked_until<now()))
      ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE notification_jobs j SET state='sending',lease_token=gen_random_uuid(),locked_until=now()+interval '2 minutes'
      FROM candidate WHERE j.id=candidate.id RETURNING j.*,candidate.state AS previous_state`,
      [options.reminderEvent ?? null],
    );
    if (!job) break;
    const unsafeRetry =
      job.attempts > 0 &&
      (job.previous_state === "sending" ||
        job.payload.transport !== "gmail" ||
        !job.last_error?.startsWith("smtp_retryable_"));
    if (unsafeRetry || job.attempts >= 8) {
      await pool.query(
        "UPDATE notification_jobs SET state='needs_review',last_error=$3,locked_until=NULL WHERE id=$1 AND lease_token=$2",
        [
          job.id,
          job.lease_token,
          unsafeRetry ? "smtp_delivery_uncertain" : "smtp_retry_exhausted",
        ],
      );
      continue;
    }
    let reminderClient: PoolClient | undefined;
    try {
      if (isReminderEvent(job.event)) {
        const guard = await lockReminderForDelivery(
          job.booking_id,
          job.event,
          job.payload.reminderDate,
          options.now,
        );
        reminderClient = guard.client;
        if (!guard.eligible) {
          await reminderClient.query(
            "UPDATE notification_jobs SET state='skipped',last_error='reminder_no_longer_needed',locked_until=NULL WHERE id=$1 AND lease_token=$2",
            [job.id, job.lease_token],
          );
          await reminderClient.query("COMMIT");
          reminderClient.release();
          reminderClient = undefined;
          continue;
        }
      }
      const q = reminderClient ?? pool;
      const recipient = await q.query(
        "SELECT email,is_active FROM users WHERE id=$1",
        [job.recipient_id],
      );
      if (
        !recipient.rows[0]?.is_active ||
        recipient.rows[0].email !== job.recipient_email
      )
        throw new DeliveryError("recipient_changed", true);
      // Freeze content on the first SMTP attempt; preserve it on definite-failure retries.
      const content = notificationContent(
        job.event as NotificationEvent,
        job.payload as NotificationPayload,
        origin,
      );
      const mail: Mail = (job.attempts > 0 ? job.payload.mail : undefined) ?? {
        from,
        to: [job.recipient_email],
        ...content,
      };
      if (mail.from !== from) throw new DeliveryError("smtp_sender_changed");
      const started = await q.query(
        "UPDATE notification_jobs SET payload=jsonb_set(payload,'{mail}',$3::jsonb) || '{\"transport\":\"gmail\"}'::jsonb,attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,now()) WHERE id=$1 AND lease_token=$2 AND locked_until>now() RETURNING id",
        [job.id, job.lease_token, JSON.stringify(mail)],
      );
      // Persist the attempt marker before SMTP; an uncertain crash must never resend.
      if (reminderClient) {
        await reminderClient.query("COMMIT");
        reminderClient.release();
        reminderClient = undefined;
      }
      if (!started.rowCount) continue;
      const providerId = await send(mail, `dogbooker/${job.id}`);
      const updated = await pool.query(
        "UPDATE notification_jobs SET state='sent',provider_id=$3,sent_at=now(),locked_until=NULL,last_error=NULL WHERE id=$1 AND lease_token=$2",
        [job.id, job.lease_token, providerId],
      );
      if (updated.rowCount) sent++;
    } catch (error) {
      if (reminderClient) {
        await reminderClient.query("ROLLBACK");
        reminderClient.release();
        reminderClient = undefined;
      }
      const permanent = !(error instanceof DeliveryError) || error.permanent;
      const code =
        error instanceof DeliveryError ? error.code : "smtp_delivery_uncertain";
      await pool.query(
        "UPDATE notification_jobs SET state=$3,last_error=$4,locked_until=NULL,available_at=now()+($5 * interval '1 minute') WHERE id=$1 AND lease_token=$2",
        [
          job.id,
          job.lease_token,
          permanent ? "needs_review" : "pending",
          code,
          Math.min(60, 2 ** (job.attempts + 1)),
        ],
      );
    }
  }
  return { configured: true, sent };
}
