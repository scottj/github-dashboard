# Device Flow Setup (Optional)

The Device Flow provides a polished "Sign in with GitHub" experience. It requires a GitHub App and a small Cloudflare Worker to proxy OAuth requests (GitHub's OAuth endpoints don't support CORS).

## 1. Create a GitHub App

1. Go to [github.com/settings/apps/new](https://github.com/settings/apps/new)
2. Fill in:
   - **Name**: anything (e.g. "My Dashboard")
   - **Homepage URL**: any URL (can be `http://localhost`)
   - **Uncheck** "Webhook > Active"
   - **Enable** "Device Flow" under OAuth
3. Under **Permissions**, set:
   - Repository: Issues (Read), Pull requests (Read), Metadata (Read)
   - Account: Notifications (Read)
4. Click **Create GitHub App**
5. Note the **Client ID** from the app's settings page

## 2. Deploy the Cloudflare Worker

```bash
npm install -g wrangler
wrangler login
wrangler deploy worker.js --name gh-dash-auth
```

This gives you a URL like `https://gh-dash-auth.<your-subdomain>.workers.dev`.

## 3. Configure index.html

In the `CONFIG` object near the top of the `<script>`, set both values:

```js
const CONFIG = {
  WORKER_URL: 'https://gh-dash-auth.<your-subdomain>.workers.dev',
  CLIENT_ID: '<your-client-id>',
  // ...
};
```

Once both values are set, the "Sign in with GitHub" button will appear on the auth screen.
