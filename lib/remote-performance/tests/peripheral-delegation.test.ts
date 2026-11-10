import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("separate peripheral admission preserves fixed policy and bootstrap boundaries", () => {
  execFileSync(
    "python3",
    [
      "-I",
      "-m",
      "unittest",
      "discover",
      "-s",
      fileURLToPath(new URL("../../peripherals/delegation/tests/", import.meta.url)),
      "-p",
      "test_*.py",
    ],
    { timeout: 30_000, stdio: "pipe" },
  );
});
