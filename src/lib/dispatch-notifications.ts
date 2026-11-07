import { after } from "next/server";
import { deliverNotifications } from "./notifications";
export function dispatchNotifications() {
  after(async () => {
    try {
      await deliverNotifications();
    } catch {
      console.error(
        "Notification worker failed; persisted jobs remain retryable",
      );
    }
  });
}
