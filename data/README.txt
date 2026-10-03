Download these files from your Stake affiliate dashboard and save them here:

- data/leaderboard.csv
  Download from: Stake affiliate dashboard > Leaderboard
  Save the CSV export or page data exactly as a CSV file.
  Expected columns: rank, user_name, total_weighted_amount (USD)

- data/referred-users.csv
  Download from: Stake affiliate dashboard > Referred Users
  Save the CSV export exactly as a CSV file.
  Expected column: user

How to use:
- Set USE_CSV_FILES=true in the terminal before starting the server, or place the files in the data/ folder and restart the app.
- The site re-reads these files every hour and when they change.
- Refresh the downloaded CSV files regularly to keep the leaderboard current.
