import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { handle, readJson } from "@/lib/http";
import { UiError, errorMessage } from "@/lib/ui";

describe("Swedish error responses", () => {
  it.each([
    [
      z.object({ email: z.email() }),
      { email: "not-an-email" },
      "Ange en giltig e-postadress.",
    ],
    [
      z.object({ name: z.string().min(1) }),
      { name: "" },
      "Namnet måste fyllas i.",
    ],
    [
      z.object({ dogName: z.string().max(80) }),
      { dogName: "a".repeat(81) },
      "Hundens namn får innehålla högst 80 tecken.",
    ],
    [
      z.object({ password: z.string().min(12) }),
      { password: "short" },
      "Lösenordet måste innehålla minst 12 tecken.",
    ],
    [
      z.object({ note: z.string().max(1000) }),
      { note: "a".repeat(1001) },
      "Anteckningen får innehålla högst 1000 tecken.",
    ],
    [
      z.object({ isActive: z.boolean() }),
      { isActive: "yes" },
      "Kontots status saknas eller har fel format.",
    ],
    [
      z.object({ startDate: z.string() }),
      {},
      "Startdatumet saknas eller har fel format.",
    ],
    [z.uuid(), "invalid", "Uppgiften saknas eller har fel format."],
  ])(
    "localizes a schema failure while retaining the error response contract",
    async (schema, input, message) => {
      const response = await handle(async () => {
        schema.parse(input);
        return Response.json({ ok: true });
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: message });
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    },
  );
  it("keeps malformed JSON and unexpected server errors in Swedish", async () => {
    const malformed = await handle(async () =>
      Response.json(
        await readJson(
          new Request("https://example.test", { method: "POST", body: "{" }),
        ),
      ),
    );
    expect(await malformed.json()).toEqual({ error: "Förfrågan är ogiltig." });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const failed = await handle(async () => {
        throw new Error("Internal English detail");
      });
      expect(failed.status).toBe(500);
      expect(await failed.json()).toEqual({
        error: "Något gick fel. Försök igen.",
      });
    } finally {
      log.mockRestore();
    }
  });
  it("does not display browser or network exception text", () => {
    expect(errorMessage(new TypeError("Failed to fetch"))).toBe(
      "Det gick inte att ansluta. Försök igen.",
    );
    expect(errorMessage(new SyntaxError("Unexpected token"))).toBe(
      "Det gick inte att ansluta. Försök igen.",
    );
    expect(errorMessage(new UiError("Datumen är upptagna."))).toBe(
      "Datumen är upptagna.",
    );
  });
});
