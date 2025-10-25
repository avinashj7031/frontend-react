// ~/frontend/src/App.js
import React from "react";

const Section = ({ id, title, children }) => (
  <section id={id} style={{marginBottom:"2.5rem"}}>
    <h2 style={{fontSize:"1.5rem", margin:"1rem 0 0.5rem"}}>{title}</h2>
    {children}
  </section>
);

const Code = ({ children }) => (
  <pre style={{
    background:"#0f172a", color:"#e2e8f0", padding:"12px 14px",
    borderRadius:12, overflowX:"auto", lineHeight:1.45
  }}>
    <code>{children}</code>
  </pre>
);

export default function App() {
  return (
    <main style={{
      fontFamily:"Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
      maxWidth:980, margin:"40px auto", padding:"0 18px"
    }}>
      <header style={{marginBottom:24}}>
        <h1 style={{fontSize:"2.25rem", margin:"0 0 0.25rem"}}>React + Flask on EC2</h1>
        <p style={{opacity:.75}}>Two-tier app, Nginx, Gunicorn, systemd, UFW, and GitHub Actions CI/CD</p>
      </header>

      <Section id="overview" title="Overview">
        <ul>
          <li>EC2 (Ubuntu 22.04+) with security groups for <b>SSH (22)</b>, <b>HTTP (80)</b>, and optionally <b>HTTPS (443)</b>.</li>
          <li>Backend: Flask served by <b>Gunicorn</b> behind <b>Nginx</b>, managed by <b>systemd</b>.</li>
          <li>Frontend: React (build served as static files by Nginx).</li>
          <li>CI/CD: GitHub Actions deploys both tiers to the EC2 host via SSH.</li>
        </ul>
      </Section>

      <Section id="arch" title="Architecture">
        <ul>
          <li>Nginx serves <code>/</code> from <code>/var/www/app</code> (React build) and proxies <code>/api/*</code> → <code>127.0.0.1:5000</code>.</li>
          <li>Gunicorn runs <code>server:app</code> (Flask) via a systemd service.</li>
          <li>UFW allows only web + ssh. EC2 security group mirrors this.</li>
        </ul>
      </Section>

      <Section id="provision" title="Provision EC2">
        <Code>{`# Launch EC2: Ubuntu 22.04 (or 24.04), t3.small or similar
# Security group: allow 22, 80 (and 443 if using TLS)

# On the instance
sudo apt update && sudo apt install -y nginx python3-venv git

# Optional: Node for building on-box (CI builds on GitHub anyway)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Enable UFW (firewall)
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
sudo ufw enable
sudo ufw status
`}</Code>
      </Section>

      <Section id="backend" title="Backend (Flask) – local setup on EC2">
        <Code>{`# Backend folder (yours):
cd ~/project/backend-sample-flask/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip gunicorn
# install your app deps (pip install -r requirements.txt if present)

# IMPORTANT: entrypoint is server.py exposing 'app'
# (we renamed from app.py to avoid clash with 'app/' package)
# server.py sample:
# from flask import Flask, jsonify
# app = Flask(__name__)
# @app.route('/')         def root(): return jsonify({"message":"Backend is running!"})
# @app.route('/api/data') def data(): return jsonify({"data":"Hello from Flask!"})
`}</Code>

        <h3 style={{marginTop:12}}>systemd service (Gunicorn)</h3>
        <Code>{`sudo tee /etc/systemd/system/flask-gunicorn.service <<'EOF'
[Unit]
Description=Flask (gunicorn) app
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/project/backend-sample-flask/backend
Environment="PATH=/home/ubuntu/project/backend-sample-flask/backend/.venv/bin"
ExecStart=/home/ubuntu/project/backend-sample-flask/backend/.venv/bin/gunicorn -w 3 -b 127.0.0.1:5000 server:app
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now flask-gunicorn
systemctl status flask-gunicorn --no-pager
curl -s http://127.0.0.1:5000/api/data && echo
`}</Code>
      </Section>

      <Section id="nginx" title="Nginx site (React + API proxy)">
        <Code>{`sudo mkdir -p /var/www/app
# (CI will publish here; for manual test you can copy a build)

sudo tee /etc/nginx/sites-available/app <<'EOF'
server {
    listen 80;
    server_name _;

    # React static
    root /var/www/app;
    index index.html;

    location / {
        try_files $uri /index.html;
    }

    # API → Flask (Gunicorn)
    location /api/ {
        proxy_pass http://127.0.0.1:5000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/app /etc/nginx/sites-enabled/app
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
`}</Code>
      </Section>

      <Section id="frontend" title="Frontend (React)">
        <Code>{`# If creating from scratch:
npx create-react-app frontend
cd ~/frontend

# Simple App.js that hits the API (already deployed on your host)
/* sample
useEffect(() => {
  fetch('/api/data').then(r=>r.json()).then(d=>setMsg(d.data));
}, []);
*/

npm run build
sudo cp -r build/* /var/www/app/
sudo nginx -t && sudo systemctl reload nginx
`}</Code>
      </Section>

      <Section id="cicd" title="CI/CD (GitHub Actions)">
        <p><b>Secrets (both repos → Settings → Secrets and variables → Actions → New repository secret)</b></p>
        <ul>
          <li><code>EC2_HOST</code> → <i>your public IP or DNS</i></li>
          <li><code>EC2_SSH_KEY</code> → <i>the <u>private</u> SSH key contents</i> that can log in as <code>ubuntu</code></li>
        </ul>

        <h3>Frontend workflow (in <code>frontend-react/.github/workflows/deploy-frontend.yml</code>)</h3>
        <Code>{`name: Deploy Frontend
on:
  push:
    branches: [ main ]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '18' }
      - name: Install and build
        run: |
          npm ci || npm install
          npm run build
      - name: Upload build to EC2
        uses: appleboy/scp-action@v0.1.7
        with:
          host: \${{ secrets.EC2_HOST }}
          username: ubuntu
          key: \${{ secrets.EC2_SSH_KEY }}
          source: "build/*"
          target: "/home/ubuntu/deploy_tmp_frontend"
      - name: Publish on EC2
        uses: appleboy/ssh-action@v1.0.0
        with:
          host: \${{ secrets.EC2_HOST }}
          username: ubuntu
          key: \${{ secrets.EC2_SSH_KEY }}
          script: |
            sudo mkdir -p /var/www/app
            sudo rm -rf /var/www/app/*
            sudo cp -r ~/deploy_tmp_frontend/* /var/www/app/
            sudo systemctl reload nginx
`}</Code>

        <h3>Backend workflow (in <code>backend-sample-flask/.github/workflows/deploy-backend.yml</code>)</h3>
        <Code>{`name: Deploy Backend
on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Upload source to EC2
        uses: appleboy/scp-action@v0.1.7
        with:
          host: \${{ secrets.EC2_HOST }}
          username: ubuntu
          key: \${{ secrets.EC2_SSH_KEY }}
          source: "."
          target: "/home/ubuntu/project/backend-sample-flask/backend"
      - name: Publish + restart service on EC2
        uses: appleboy/ssh-action@v1.0.0
        with:
          host: \${{ secrets.EC2_HOST }}
          username: ubuntu
          key: \${{ secrets.EC2_SSH_KEY }}
          script: |
            cd ~/project/backend-sample-flask/backend
            python3 -m venv .venv
            source .venv/bin/activate
            pip install -U pip gunicorn
            [ -f requirements.txt ] && pip install -r requirements.txt || true
            sudo systemctl restart flask-gunicorn
            sudo systemctl reload nginx
`}</Code>
      </Section>

      <Section id="troubleshooting" title="Troubleshooting (real errors we hit)">
        <ul>
          <li><b>Cannot reach port 5000 from laptop</b> – That’s expected now: Gunicorn binds on <code>127.0.0.1</code>. Use Nginx on port 80.</li>
          <li><b>502 Bad Gateway</b> – Gunicorn not listening or wrong module. Check:
            <Code>{`systemctl status flask-gunicorn --no-pager
journalctl -u flask-gunicorn -n 100 --no-pager
sudo ss -ltnp | grep :5000`}</Code>
            We fixed “Failed to find attribute 'app' in 'app'” by renaming <code>app.py</code> → <code>server.py</code> and using <code>server:app</code>.
          </li>
          <li><b>Port already in use</b> – kill old dev server:
            <Code>{`sudo systemctl stop flask-gunicorn
pkill -f "python app.py" || true
pkill -f gunicorn || true
sudo systemctl start flask-gunicorn`}</Code>
          </li>
          <li><b>GitHub Actions SSH handshake failed</b> – Use the <u>private</u> key in secret <code>EC2_SSH_KEY</code> (not the public). Ensure login as <code>ubuntu</code> and security group allows SSH from GitHub runners.</li>
          <li><b>npm / CRA warnings</b> – CRA is deprecated but fine for this demo. CI uses <code>npm ci || npm install</code> to avoid lock conflicts.</li>
        </ul>
      </Section>

      <Section id="cheats" title="Cheat Sheet (EC2)">
        <Code>{`# Services
systemctl status flask-gunicorn --no-pager
sudo systemctl restart flask-gunicorn
sudo nginx -t && sudo systemctl reload nginx

# Logs
journalctl -u flask-gunicorn -f
sudo tail -f /var/log/nginx/error.log

# Network
sudo ss -ltnp
curl -i http://127.0.0.1:5000/api/data
curl -i http://YOUR_PUBLIC_IP/api/data
`}</Code>
      </Section>

      <Section id="feature" title="Add a new feature and deploy (end-to-end)">
        <ol>
          <li><b>Backend</b>: add a route, commit, push.
            <Code>{`# server.py (example)
@app.route('/api/time')
def time():
    import datetime as dt
    return jsonify({"now": dt.datetime.utcnow().isoformat()+"Z"})

git checkout -b feature/time-endpoint
git commit -am "Add /api/time"
git push -u origin feature/time-endpoint
# open PR → merge to main → GitHub Action deploys → service restarts
`}</Code>
          </li>
          <li><b>Frontend</b>: call the new endpoint and render, then push.
            <Code>{`// some component
useEffect(() => {
  fetch('/api/time').then(r=>r.json()).then(d=>setNow(d.now));
}, []);

git checkout -b ui-show-time
git commit -am "Show /api/time"
git push -u origin ui-show-time
# merge to main → GitHub Action builds, uploads, publishes, reloads Nginx
`}</Code>
          </li>
          <li>Validate:
            <Code>{`curl -s http://YOUR_PUBLIC_IP/api/time && echo
open http://YOUR_PUBLIC_IP/`}</Code>
          </li>
        </ol>
      </Section>

      <footer style={{marginTop:32, opacity:.65}}>
        <p>Deployed on: EC2 (Ubuntu), Nginx, Gunicorn, systemd · CI/CD: GitHub Actions</p>
      </footer>
    </main>
  );
}

