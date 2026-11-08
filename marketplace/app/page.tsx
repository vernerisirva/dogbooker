import { headers } from "next/headers";
import { auth, authPool } from "../lib/auth";
import { dashboard } from "../lib/service";
import { todayStockholm } from "../lib/dates";
import { Marketplace, Login } from "./ui";
export default async function Page() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return <Login />;
  const { rows } = await authPool.query(
    'SELECT "isActive" FROM "user" WHERE id=$1',
    [session.user.id],
  );
  if (!rows[0]?.isActive) return <Login />;
  return (
    <Marketplace
      initial={await dashboard(session.user.id)}
      user={{ name: session.user.name }}
      today={todayStockholm()}
    />
  );
}
