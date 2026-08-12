# Plan: Cloudflare R2 Integration Guide and Implementation

The project already has logic for Cloudflare R2 in `src/lib/storage.ts` and Supabase Edge Functions. However, it seems the integration is currently marked as "Not Integrated" in the Admin Dashboard because the required environment variables (secrets) are missing or invalid.

## User Review Required

> [!IMPORTANT]
> To enable Cloudflare R2, you need to provide the following credentials from your Cloudflare Dashboard:
> 1. **R2 Account ID**: Found on the Cloudflare R2 overview page.
> 2. **R2 Access Key ID** & **R2 Secret Access Key**: Created via "Manage R2 API Tokens". The token must have **Edit** permissions.
> 3. **R2 Bucket Name**: The name of the bucket you created (e.g., `medflow-assets`).
> 4. **R2 Public URL**: The "Public Bucket URL" or a Custom Domain pointing to your bucket (e.g., `https://pub-xyz.r2.dev`).
> 5. **CORS Policy**: You must add a CORS policy to your R2 bucket to allow uploads from `https://*.lovable.app` (or your custom domain) with `PUT` and `GET` methods.

## Proposed Changes

### Backend (Edge Functions)
- Verify `r2-usage` correctly reports configuration status.
- Ensure `r2-sign-upload` and `r2-delete` use the centralized `r2Config` utility.

### Frontend
- Update `StorageMonitoring.tsx` to provide a clear "Setup Guide" when R2 is not integrated.
- Add a visual indicator or button in the Admin section to trigger the secret entry form.

### Documentation
- Provide a step-by-step guide for the user to follow in the Cloudflare Dashboard.

## Technical Details

### Environment Variables
We will use the following secrets:
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `R2_PUBLIC_URL` (This one must also be added as a Vite public env var `VITE_R2_PUBLIC_URL` to enable the frontend logic)

### CORS Configuration for R2
```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "PUT", "DELETE", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": [],
    "MaxAgeSeconds": 3000
  }
]
```
*(Note: Using `*` for AllowedOrigins is easiest for development, but it should be restricted to your app domain for production.)*
