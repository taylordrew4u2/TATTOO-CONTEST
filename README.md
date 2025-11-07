# TATTOO-CONTEST

A live tattoo contest app where users submit photos, and admins pick winners.

## What It Does

**For Users:**

- Submit a tattoo photo with a caption, name, and phone number
- See all submissions in a live feed (your name stays hidden)
- View winners when the contest ends

**For Admins:**

- Log in at `/admin` (password: `pins2025lol`)
- See all submissions with full details
- Pick the top 3 winners per category
- Winners update live on the public page

## How to Run

1. **Install:**

   ```bash
   npm install
   ```

2. **Start:**

   ```bash
   npm start
   ```

3. **Open in browser:**

   ```
   http://localhost:3000
   ```

## Admin Login

- URL: `http://localhost:3000/admin`
- Password: `pins2025lol`

## Notes

- Photos are uploaded to Cloudinary (API key already configured in `.env`)
- All data resets when the server restarts (demo mode)
- To deploy: Use Fly.io with the included `Dockerfile` and `fly.toml`
