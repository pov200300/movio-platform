# Legal Media Frontend

This is the Next.js (App Router) Headless Frontend for the Legal Media Platform.

## Prerequisites
- Node.js (v18.17.0 or newer)
- npm or yarn

## Setup on VPS

1. Clone or copy this directory (`frontend`) to your VPS.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure Environment Variables:
   Create a `.env.local` file in the root of the `frontend` directory:
   ```env
   NEXT_PUBLIC_WP_API_URL=https://your-wordpress-site.com/wp-json/wp/v2
   ```

4. Run the development server (for testing):
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

5. Build for Production:
   ```bash
   npm run build
   npm run start
   ```

## Using with Nginx
When deploying on the same VPS as WordPress, configure Nginx to reverse proxy to this Node app (running on port 3000) for the main domain, while routing `/wp-admin` and `/wp-json` to the PHP-FPM backend.
