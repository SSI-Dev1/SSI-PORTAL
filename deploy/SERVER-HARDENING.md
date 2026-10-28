# VPS hardening checklist (Ubuntu 24.04 LTS)

The CRM is a static site. The server only serves files over HTTPS; it holds no
database credentials. Run these as a sudo user. Replace `crm.example.com`.

## 1. Accounts and SSH
```bash
adduser deploy && usermod -aG sudo deploy
# copy your public key: ssh-copy-id deploy@server  (from your machine)
sudo sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/; s/^#\?PermitRootLogin .*/PermitRootLogin no/; s/^#\?KbdInteractiveAuthentication .*/KbdInteractiveAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart ssh
```
Use SSH keys only (ed25519, passphrase-protected). Consider moving SSH behind a VPN or allow-listing your office IP in the firewall.

## 2. Firewall — only 22 (SSH), 80 and 443
```bash
sudo ufw default deny incoming && sudo ufw default allow outgoing
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full'
sudo ufw enable && sudo ufw status verbose
```
Do not run a database on this host. Supabase is reached only by browsers over HTTPS.

## 3. Updates, brute-force protection, minimal services
```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y unattended-upgrades fail2ban nginx certbot python3-certbot-nginx
sudo dpkg-reconfigure -plow unattended-upgrades
sudo systemctl enable --now fail2ban          # protects sshd by default
systemctl list-units --type=service --state=running   # disable anything you don't need
```

## 4. TLS and nginx
```bash
sudo mkdir -p /var/www/ssi-crm && sudo chown deploy: /var/www/ssi-crm
sudo cp deploy/nginx.conf /etc/nginx/sites-available/ssi-crm
sudo ln -s /etc/nginx/sites-available/ssi-crm /etc/nginx/sites-enabled/ && sudo rm -f /etc/nginx/sites-enabled/default
sudo certbot --nginx -d crm.example.com      # auto-renews via systemd timer
```
In `nginx.conf`, replace `<project-ref>` and the `sha256-…` value with the hash printed by:
```bash
grep -o "sha256-[A-Za-z0-9+/=]*" dist/index.html
```
Verify with https://securityheaders.com and https://www.ssllabs.com/ssltest/ (target A+).

## 5. Deploying
Build on a trusted machine or CI with the production `.env` (public values only):
```bash
npm ci && npm run build && npm audit --omit=dev
rsync -a --delete dist/ deploy@crm.example.com:/var/www/ssi-crm/
```
Never copy `.env`, `.git` or source maps to the server (nginx also refuses to serve them).

## 6. DDoS and abuse
nginx rate limits per IP are configured. For volumetric attacks put the site behind a
CDN/WAF with DDoS protection (e.g. Cloudflare — proxy mode, "Full (strict)" TLS) and
enable Supabase's auth rate limits and CAPTCHA (see SECURITY.md).

## 7. Backups
Daily encrypted database backups: `deploy/backup.sh` (pg_dump → gzip → age).
Keep the age private key offline. Test a restore into a scratch Supabase project
quarterly. Back up Storage (documents) separately, also encrypted.

## 8. Monitoring
- Supabase → Logs: Auth (failed sign-ins, rate-limit hits), API, Storage.
- Supabase → Advisors (security & performance) after every migration.
- In-app audit log (Settings → Audit log, Super Admin only).
- Uptime monitor on https://crm.example.com and alerting on certificate expiry.
- `sudo fail2ban-client status sshd` and `/var/log/nginx/error.log` on the VPS.
