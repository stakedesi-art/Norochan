Optional local files the site can read. None of them are committed.

- src/data/leaderboard.csv
  Download from: Stake affiliate dashboard > Leaderboard
  Expected columns: rank, user_name, total_weighted_amount (USD)
  Used only when the Stake API is unavailable or the file is present as a fallback.

- src/data/rewards.json
  Copy src/data/rewards.example.json and fill in currentPrizePool plus the three payout figures
  (leaderboardPayout, levelUpBonus, socialMediaGiveaways).
  The public site reads this file (or REWARDS_FILE) and re-reads it whenever it changes.
  Leave a field null to show a dash instead of a made-up number.
  On Lightsail this file lives at /var/lib/norochan/rewards.json.
