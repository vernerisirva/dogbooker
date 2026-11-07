export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function databaseError(error: unknown): never {
  const codes: string[] = [];
  let current = error;
  for (let i = 0; i < 4 && current && typeof current === "object"; i++) {
    if (
      "constraint" in current &&
      current.constraint === "entries_same_day_times_check"
    )
      throw new AppError(
        "Hämtningstiden måste vara senare än lämningstiden för en vistelse samma dag.",
      );
    if (
      "constraint" in current &&
      ["entries_arrival_window_check", "entries_pickup_time_check"].includes(
        String(current.constraint),
      )
    )
      throw new AppError(
        "Välj en tid mellan 06:00 och 23:00, i steg om 15 minuter.",
      );
    if ("code" in current) codes.push(String(current.code));
    current = "cause" in current ? current.cause : null;
  }
  if (codes.includes("23P01"))
    throw new AppError(
      "Datumen är inte längre tillgängliga. Välj en annan period.",
      409,
    );
  if (codes.includes("23505"))
    throw new AppError("Kontot eller förfrågan finns redan.", 409);
  throw error;
}
