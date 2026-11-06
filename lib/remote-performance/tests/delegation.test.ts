import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("frozen host delegation authenticates candidates without executing app actions", () => {
  execFileSync(
    "python3",
    [
      "-I",
      "-m",
      "unittest",
      "discover",
      "-s",
      fileURLToPath(new URL("../delegation/tests/", import.meta.url)),
      "-p",
      "test_*.py",
    ],
    { timeout: 30_000, stdio: "pipe" },
  );
});
