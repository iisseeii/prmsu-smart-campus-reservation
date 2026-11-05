# PRMSU Smart Campus Reservation System

A website for students to reserve campus equipment and for faculty/admins to manage inventory and reservation decisions. It uses HTML, CSS, JavaScript, Node.js, Express, and Supabase.

## Project files

```text
prmsu-smart-campus-reservation/
├── database/
│   ├── schema.sql                    # Creates database tables, policies, and starter equipment
│   ├── reservation-workflow.sql      # Saves faculty decisions and updates approved stock
│   └── provision-admin.sql           # Promotes an existing Supabase account to administrator
├── public/
│   ├── index.html                    # Website page structure
│   ├── style.css                     # Website styles and layout
│   └── app.js                        # Browser behavior and API requests
├── .env.example                      # Template for required environment variables
├── server.js                         # Express server and API
├── package.json                      # Dependencies and run commands
└── README.md                         # This guide
```

## Run locally

You need Node.js and a Supabase project.

1. Open a terminal in this project folder and install dependencies:

   ```bash
   npm install
   ```

2. In your Supabase project, open **SQL Editor** and run `database/schema.sql`, then `database/reservation-workflow.sql`.

3. Copy `.env.example` to `.env` and fill in `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` from **Supabase → Project Settings → API**. Keep the service-role key private.

   PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

4. Start the website:

   ```bash
   npm start
   ```

5. Open [http://localhost:3000](http://localhost:3000).

To stop the server, press `Ctrl+C` in the terminal. If port 3000 is already in use, set `PORT=3001` in `.env`, restart, and open `http://localhost:3001`.

## Deploy online with Render

1. Push this project to a GitHub repository. Do not include `.env` or any secret keys.
2. In [Render](https://render.com), choose **New → Web Service** and connect the repository.
3. Set the **Root Directory** to `prmsu-smart-campus-reservation` if this project is inside a parent repository; otherwise leave it blank.
4. Use these settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. In Render's **Environment** settings, add:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
6. Deploy the service and open the URL Render provides.
7. In Supabase **Authentication → URL Configuration**, set the production Site URL to the Render URL and add it to the allowed redirect URLs.

The Supabase database scripts need to be run only once per project, before using the deployed website. Keep all Supabase keys private; never add them to `public/` files or commit `.env`.
