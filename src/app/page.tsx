import { dispatchNotifications } from "@/lib/dispatch-notifications";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/access";
import { AppError } from "@/lib/errors";
import { calendar } from "@/lib/booking-service";
import { todayStockholm } from "@/lib/dates";
import { Dashboard } from "@/components/dashboard";
export const dynamic = "force-dynamic";
export default async function Home() {
  let actor;
  try {
    actor = await requireActor(await headers());
  } catch (e) {
    if (e instanceof AppError && [401, 403].includes(e.status))
      redirect("/login");
    throw e;
  }
  dispatchNotifications();
  return (
    <Dashboard initial={await calendar(actor, todayStockholm().slice(0, 7))} />
  );
}
