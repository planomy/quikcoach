# Railway notes for Quik Coach
#
# One-time:
#   npx @railway/cli login
#   cd ~/quikcoach && npx @railway/cli init
#   npx @railway/cli up
#
# App must listen on process.env.PORT (already does) and 0.0.0.0.
# SQLite lives on the container filesystem — add a Railway Volume mounted at
# /app/server/data if you need drafts to survive redeploys.
