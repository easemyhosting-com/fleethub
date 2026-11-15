import { expect, it } from "vitest";
import { errorSummary } from "../src/lib/log/safe-error";

it("keeps the error class and a sanitized code, never the message", () => {
  const driver = Object.assign(new Error('duplicate key value (email)=(user@example.com) violates "users_email_key"'), { code: "23505" });
  expect(errorSummary(driver)).toBe("Error 23505");
  expect(errorSummary(new TypeError("fetch failed for https://vault.example.com/api"))).toBe("TypeError");
  const forged = errorSummary(Object.assign(new Error("x"), { code: "E1\nforged log line user@example.com" }));
  expect(forged).toMatch(/^Error E1[A-Za-z0-9_.-]*$/);
  expect(forged.length).toBeLessThanOrEqual("Error ".length + 40);
  expect(errorSummary("raw string with secrets")).toBe("string");
  expect(errorSummary(null)).toBe("object");
});
