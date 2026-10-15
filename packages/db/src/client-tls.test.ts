import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "./client.js";

afterEach(() => vi.unstubAllEnvs());

describe("Postgres TLS configuration", () => {
  it("uses the bundled Supabase CA and cannot disable verification through the URL", async () => {
    vi.stubEnv("DATABASE_SSL_CA", "");
    const connection = createDatabase({
      databaseUrl: "postgresql://localhost/test?sslmode=disable&uselibpqcompat=true",
    });
    try {
      if (connection.kind !== "postgres") throw new Error("Expected Postgres");
      const options = connection.db.$client.options;
      expect(options.connectionString).not.toContain("sslmode");
      expect(options.connectionString).not.toContain("uselibpqcompat");
      const ssl = options.ssl;
      expect(ssl).toMatchObject({ rejectUnauthorized: true });
      if (!ssl || typeof ssl === "boolean" || typeof ssl.ca !== "string") {
        throw new Error("Expected a PEM CA");
      }
      const certificate = new X509Certificate(ssl.ca);
      expect(certificate.subject).toContain("CN=Supabase Root 2021 CA");
      expect(new Date(certificate.validTo).getTime()).toBeGreaterThan(Date.now());
    } finally {
      await connection.close();
    }
  });

  it("resolves DATABASE_SSL_CA relative to the repository, independently of the caller", async () => {
    vi.stubEnv("DATABASE_SSL_CA", "packages/db/certs/supabase-ca.crt");
    const connection = createDatabase({ databaseUrl: "postgresql://localhost/test" });
    try {
      if (connection.kind !== "postgres") throw new Error("Expected Postgres");
      expect(connection.db.$client.options.ssl).toMatchObject({
        ca: readFileSync(new URL("../certs/supabase-ca.crt", import.meta.url), "utf8"),
        rejectUnauthorized: true,
      });
    } finally {
      await connection.close();
    }
  });

  it("does not read TLS files for the local PGlite fallback", async () => {
    vi.stubEnv("DATABASE_SSL_CA", "missing-certificate.crt");
    const connection = createDatabase({ databaseUrl: "", dataDir: "memory://" });
    try {
      expect(connection.kind).toBe("pglite");
      if (connection.kind === "pglite") await connection.db.$client.waitReady;
    } finally {
      await connection.close();
    }
  }, 30_000);
});
