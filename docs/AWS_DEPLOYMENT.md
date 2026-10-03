# AWS deployment (Lightsail)

The site is one Node.js process with no npm packages. It stores its data in one JSON file, which makes a single AWS Lightsail instance the simplest and cheapest fit. Caddy sits in front of it for HTTPS.

```
Browser ──HTTPS──> Caddy :443 (Lightsail instance) ──> node server.js 127.0.0.1:3000
                                                        └─ /var/lib/norochan/data.json
```

## What runs where
| Piece | Location on the instance |
|---|---|
| Code (this repo) | `/opt/norochan` (owned by root, read-only to the app) |
| Secrets and settings | `/etc/norochan/norochan.env` (root, mode 600) |
| Data (BotRix snapshots) | `/var/lib/norochan/data.json` (user `norochan`, mode 600) |
| Public prize pool / bonuses | `/var/lib/norochan/rewards.json` (user `norochan`, mode 600) |
| App service | systemd unit `norochan` (`deploy/lightsail/norochan.service`) |
| HTTPS | Caddy (`deploy/lightsail/Caddyfile`), automatic Let's Encrypt certificate |
| Logs | `journalctl -u norochan` |

Keeping data outside `/opt/norochan` means a `git pull` or a fresh clone can never overwrite or delete it.

## 1. Create the instance
1. In the Lightsail console, create an instance: **Linux/Unix**, **OS Only**, **Ubuntu 24.04 LTS**. The 1 GB RAM plan is enough to start.
2. **Networking**: create a **static IP** and attach it to the instance.
3. **Firewall (IPv4 and IPv6)**: allow 22 (SSH, ideally restricted to your IP), 80 (HTTP, needed for the certificate) and 443 (HTTPS). Do not open 3000.
4. **Snapshots**: turn on **automatic snapshots**. They back up the whole disk, `data.json` included, once a day.
5. At your domain registrar, add an **A record** for your domain pointing to the static IP. Wait until it resolves before step 3.

## 2. Get the code onto the instance
SSH in (browser SSH in the console works), then:
```
sudo git clone <your-repo-url> /opt/norochan
```

## 3. Run the setup script
```
sudo bash /opt/norochan/deploy/lightsail/setup.sh your-domain.com
```
This installs Node 22 and Caddy and creates the `norochan` system user and folders. It writes `/etc/norochan/norochan.env` from the template (only if missing), installs the systemd unit and Caddyfile, then starts both services. It is safe to run again.

## 4. Fill in the secrets
```
sudo nano /etc/norochan/norochan.env
sudo systemctl restart norochan
```
Set `STAKE_TOKEN` and anything else you use (BotRix). Leave `HOST=127.0.0.1`, `HSTS=1`, `DATA_FILE=/var/lib/norochan/data.json` and `REWARDS_FILE=/var/lib/norochan/rewards.json` as they are. Check the startup lines with `sudo journalctl -u norochan -n 20`.

Copy `src/data/rewards.example.json` to `/var/lib/norochan/rewards.json` and edit the prize pool / bonus figures there. If an old `data.json` still has visitor accounts, stop the site and run `DATA_FILE=/var/lib/norochan/data.json npm run migrate` from `/opt/norochan`.

## Moving existing data
If you already have a `src/data.json` locally, copy it up and put it in place while the app is stopped:
```
scp src/data.json ubuntu@<static-ip>:/tmp/data.json
sudo systemctl stop norochan
sudo install -o norochan -g norochan -m 600 /tmp/data.json /var/lib/norochan/data.json
rm /tmp/data.json
sudo systemctl start norochan
```

## Updating the site
```
sudo git -C /opt/norochan pull --ff-only
sudo systemctl restart norochan
```
If `deploy/lightsail/` files changed, re-run `setup.sh` to reinstall them.

## Backups
- Lightsail automatic snapshots cover the whole disk daily.
- For more frequent copies of just the data file, add a root cron job, for example hourly:
  `0 * * * * install -m 600 /var/lib/norochan/data.json /var/lib/norochan/backup-$(date +\%H).json`
  This keeps 24 rolling hourly copies on the same disk, which snapshots then capture too.

## Limits of this setup
- **One instance only.** The BotRix store lives in a single process. Do not put two instances behind a load balancer until storage moves to a database.
- **Restarts are brief outages** (about a second). That is fine at this scale.

## Moving to a database later (Postgres)
All persistence goes through `src/storage/index.js`, which today exports the JSON file driver from `src/storage/file-store.js`. A driver must provide:

| Member | Meaning |
|---|---|
| `db` | One stable in-memory object `{ viewerLeaderboard }`. Modules keep a reference to it, so it is never replaced, only refilled. |
| `load()` | Called once at startup, before the server listens. Fills `db`. |
| `save()` | Called after every change. Persists `db`. Synchronous today. |
| `driver`, `location` | Labels for logs. |

The planned path is a Lightsail managed PostgreSQL database (or Amazon RDS for PostgreSQL), with `DATABASE_URL` kept in `/etc/norochan/norochan.env` only:
1. Add `src/storage/postgres-store.js` with the same members. Have `load()` read the tables into `db`, and make `save()` write the changes back.
2. Make `src/storage/index.js` pick the driver from the environment (for example `DATABASE_URL` set means Postgres).
3. Because Postgres calls are asynchronous, `save()` either queues writes in the background or becomes `async`, with its callers awaiting it. That is the one code change outside `src/storage/` this migration needs. Route handlers and services do not change otherwise.
4. Write a one-off import script that reads `data.json` into the new tables.

Once data lives in Postgres, the site can run on more than one instance.
