import type { FormEvent } from "react";
import { sv } from "./swedish";

/** Only deliberate interface messages should reach the UI, never browser/network errors. */
export class UiError extends Error {}
export function errorMessage(
  error: unknown,
  fallback: string = sv.errors.connection,
) {
  return error instanceof UiError ? error.message : fallback;
}

// Native validation normally follows the browser language, not the document language.
// Keep the browser's validation rules and focus behavior, but provide Swedish messages.
type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
function field(event: FormEvent<HTMLFormElement>): Field | null {
  const target = event.target;
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
    ? target
    : null;
}
export function localizeValidation(event: FormEvent<HTMLFormElement>) {
  const input = field(event);
  if (!input) return;
  input.setCustomValidity("");
  const validity = input.validity;
  if (validity.valid) return;
  let message: string = sv.errors.invalid;
  if (validity.valueMissing) message = "Fyll i det här fältet.";
  else if (validity.typeMismatch) message = "Ange en giltig e-postadress.";
  else if (validity.tooShort && "minLength" in input)
    message = `Använd minst ${input.minLength} tecken.`;
  else if (validity.tooLong && "maxLength" in input)
    message = `Använd högst ${input.maxLength} tecken.`;
  else if (validity.rangeUnderflow)
    message = "Välj tidigast det första tillåtna datumet.";
  else if (validity.rangeOverflow)
    message = "Välj senast det sista tillåtna datumet.";
  else if (validity.badInput) message = "Ange ett giltigt värde.";
  input.setCustomValidity(message);
}
export function clearValidation(event: FormEvent<HTMLFormElement>) {
  field(event)?.setCustomValidity("");
}
