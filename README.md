# PRMSU Smart Campus Reservation System

A campus website for students to reserve equipment and for faculty or administrators to manage equipment and reservation decisions. The application uses Node.js, Express, HTML, CSS, JavaScript, and Supabase.

## Folders and files

```text
prmsu-smart-campus-equipment-reservation/
├── prmsu-smart-campus-reservation/    # The actual website application
│   ├── database/
│   │   ├── schema.sql                 # Creates the Supabase tables and starter equipment
│   │   └── provision-admin.sql        # Promotes an existing account to administrator
│   ├── public/
│   │   ├── index.html                 # Website page structure
│   │   ├── style.css                  # Website appearance
│   │   └── app.js                     # Browser interactions
│   ├── server.js                      # Express server and API
│   ├── package.json                   # Dependencies and commands
│   └── .env.example                   # Environment-variable template
├── .gitignore                         # Files Git should not upload
└── README.md                          # This guide
```

## Run locally

You need Node.js and a Supabase project.

1. Open PowerShell in the website folder:

   ```powershell
   cd "C:\Users\rglds\Downloads\prmsu-smart-campus-equipment-reservation\prmsu-smart-campus-reservation"
   ```

2. Install the dependencies:

   ```powershell
   npm install
   ```

3. In the Supabase Dashboard, open **SQL Editor** and run `database/schema.sql`, followed by `database/reservation-workflow.sql`.

4. Copy `.env.example` to `.env` if you do not already have `.env`, then fill in `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` from **Project Settings → API**.

   ```powershell
   Copy-Item .env.example .env
   ```

   Keep the service-role key private. Do not put keys in `public/` or upload `.env`.

5. Start the website and open it in your browser:

   ```powershell
   npm start
   ```

   Go to [http://localhost:3000](http://localhost:3000). Stop the server with `Ctrl+C`.

## Deploy with Vercel

1. Push the project to GitHub. Ensure `.env` and all secret keys are excluded.
2. In Vercel, select **Add New → Project** and import the GitHub repository.
3. Set **Root Directory** to `prmsu-smart-campus-reservation` (the folder containing `package.json` and `server.js`).
4. In **Project Settings → Environment Variables**, add:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Deploy the project. Set the Vercel production URL in Supabase under **Authentication → URL Configuration** as the Site URL and an allowed redirect URL.

Run the two Supabase SQL scripts before using the deployed website. Keep all secret keys private.
