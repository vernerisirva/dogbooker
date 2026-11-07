import type { ZodError } from "zod";
import { sv } from "./swedish";

const fields: Record<string, string> = {
  name: "Namnet",
  email: "E-postadressen",
  dogName: "Hundens namn",
  password: "Lösenordet",
  startDate: "Startdatumet",
  endDate: "Slutdatumet",
  ownerId: "Hundägaren",
  isActive: "Kontots status",
  note: "Anteckningen",
  token: "Inbjudan",
};

/** Translate validation at the response boundary without changing schemas or API fields. */
export function validationMessage(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return sv.errors.invalid;
  const key = String(issue.path.at(-1) ?? "");
  const label = fields[key] ?? "Uppgiften";
  if (key === "arrivalTime" || key === "pickupTime")
    return "Välj en tid mellan 06:00 och 23:00 i formatet HH:mm, i steg om 15 minuter.";
  if (key === "expectedRevision") return "Uppdatera bokningen och försök igen.";
  if (key === "token") return "Inbjudan är ogiltig.";
  if (issue.code === "invalid_format" && key === "email")
    return "Ange en giltig e-postadress.";
  if (issue.code === "too_small" && issue.origin === "string")
    return issue.minimum === 1
      ? `${label} måste fyllas i.`
      : `${label} måste innehålla minst ${issue.minimum} tecken.`;
  if (issue.code === "too_big" && issue.origin === "string")
    return `${label} får innehålla högst ${issue.maximum} tecken.`;
  if (issue.code === "invalid_type" || issue.code === "invalid_format")
    return `${label} saknas eller har fel format.`;
  return sv.errors.invalid;
}
