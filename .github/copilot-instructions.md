# Rules for this repo (React 19 + Vite + Supabase + Dexie, Liberian susu collector app)
- Make the smallest change that fixes the problem. No refactors, renames or reformatting of unrelated code.
- Change at most 2 files per request. If more are needed, say so and stop.
- Never invent functions, columns, tables or imports. Search the repo first.
- Money is `numeric` in the database. Never use floating-point math for stored amounts.
- Never edit an existing file in `supabase/migrations/`. Add a new numbered file.
- Never put secrets or service-role keys under `src/`.
- Never swallow an error. Show the user a message or rethrow.
- The project must pass `npm run typecheck` and `npm run build` after every change.
- Explain each change in 3 sentences or fewer.
