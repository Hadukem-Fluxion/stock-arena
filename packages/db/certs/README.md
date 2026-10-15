# Database certificate authority

`supabase-ca.crt` is a public CA certificate, not a credential or a private key.

- Official download: https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
- Subject common name: `Supabase Root 2021 CA`.
- Expires: 26 April 2031, 10:56:53 UTC.
- Downloaded and checked on 15 October 2026.

Keep this directory in Railway/deployment artifacts. The database client resolves
the default path from its module, independently of the process working directory.
Override with `DATABASE_SSL_CA` for a replacement CA; relative paths resolve from
the repository root. TLS verification must remain enabled.

On a machine with OpenSSL, verify a replacement before committing it:

```sh
openssl x509 -in packages/db/certs/supabase-ca.crt -noout -subject -enddate
```

The local setup had no OpenSSL executable. The initial download was checked using
Node's OpenSSL-backed `crypto.X509Certificate` API for subject and expiry, then
used to verify a real Supabase connection with `rejectUnauthorized: true`.
