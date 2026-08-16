# Khamec HMS Neon Project Setup

The standalone Neon project has been created for the Khamec HMS clone.

| Setting | Value |
|---|---|
| Project name | Khamec HMS Neon |
| Organization | Dev_Walid |
| Project ID | quiet-heart-24036829 |
| Main branch ID | br-plain-shape-ayaa1gw4 |
| Database | neondb |

The privileged connection string is intentionally not stored in this repository. It must be supplied as a server-side secret in local development and Netlify environment variables. The existing Supabase production project and the original repository remain separate and unchanged.

## Intended deployment boundary

The Neon clone will use a server-side API for database access. The browser must never receive `DATABASE_URL`, a Neon role password, or R2 secret credentials. Cloudflare R2 remains the file store, with signed or server-mediated upload and deletion operations.

## Current migration stage

The project is newly provisioned and ready for schema import. Application migration work must proceed in bounded steps: schema and functions first, then server API, authentication and authorization, realtime transport, R2 integration, workflow parity, and finally Netlify deployment configuration.

