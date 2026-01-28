# Deploying to IONOS VPS

This guide explains how to transfer your **RM365 Tools** application to an IONOS VPS (running Linux/Ubuntu) and run it alongside your IONOS databases.

## Prerequisites

1.  **IONOS VPS**: You need a Linux VPS (Ubuntu 22.04 or 24.04 recommended).
2.  **Access**: SSH access to your VPS.
3.  **Database Connection**: Your `.env` file is already configured for IONOS databases (SSL enabled).

## Step 1: Bootstrap the VPS

Since your VPS starts empty, we first need to install Git manually so we can download your code.

1.  Connect to your VPS via SSH:
    ```bash
    ssh root@<your-vps-ip>
    ```

2.  Update package lists and install Git:
    *(Run this command directly. Do not type 'bash' before it.)*
    ```bash
    apt update && apt install -y git
    ```

## Step 2: Install the Application & Dependencies

1.  Clone your repository to `/opt/rm365-tools-testing` (standard location):
    ```bash
    cd /opt
    git clone https://github.com/helenrm365/rm365-tools-testing.git
    # If using a private repo, consider setting up a credential helper or SSH keys so git pull works passwordless.
    # Example (using HTTPS token):
    # git config credential.helper store
    # (Then run a manual 'git pull' once to store the credentials)
    ```

2.  **Run the Setup Script**:
    Now that the code is on the server, use the included script to install Python, Virtualenv, and system libraries.
    ```bash
    cd /opt/rm365-tools-testing
    # First, fixes line endings just in case
    sed -i 's/\r$//' deploy/setup_vps.sh
    chmod +x deploy/setup_vps.sh
    ./deploy/setup_vps.sh
    ```
    *This will install python3, pip, venv, build-essential, libpq-dev, and dos2unix.*

3.  **Prepare Executables**:
    Run these commands to ensure all scripts are Linux-ready:
    ```bash
    dos2unix deploy/*.sh
    chmod +x deploy/*.sh
    ```

4.  Copy your local `.env` file to the VPS:
    *   On your LOCAL machine (where you are now), run:
        ```bash
        scp .env root@<your-vps-ip>:/opt/rm365-tools-testing/.env
        ```

## Step 3: Configure the Service (Systemd)

We use `systemd` to keep your application running in the background and restart it if it crashes or the server reboots.

1.  Link the service file:
    ```bash
    ln -s /opt/rm365-tools-testing/deploy/rm365-tools.service /etc/systemd/system/rm365-tools.service
    ```

2.  Reload systemd registration:
    ```bash
    systemctl daemon-reload
    ```

3.  Enable and Start the service:
    ```bash
    systemctl enable rm365-tools
    systemctl start rm365-tools
    ```

**Important Note on Ports/Firewall**:
By default, this application runs on **port 8000**.
1.  If you want to access it securely via `https://rm365-toolbox.com`, you should set up a Reverse Proxy (Nginx) and use Certbot for SSL.
2.  If you want to access it directly via IP (`http://79...:8000`), you must ensure **Port 8000 is open** in your IONOS Firewall settings (Cloud Panel > Network > Firewall Policies).

## Step 4: Verify Deployment

1.  Check the status:
    ```bash
    systemctl status rm365-tools
    ```
    You should see "Active: active (running)".

2.  View live logs:
    ```bash
    journalctl -u rm365-tools -f
    ```

3.  Access the app:
    Open `http://<your-vps-ip>:8000` in your browser.

## Automatic Updates

The system is configured (via `deploy/start_vps.sh`) to automatically:
1.  Check for GitHub updates every 10 seconds.
2.  Updates from `main` branch are pulled automatically.
3.  Dependencies (`requirements.txt`) are installed if changed.
4.  The server restarts automatically.

To trigger an update, simply push to your `main` branch on GitHub.

## Troubleshooting

*   **Database Connection Errors**: Ensure `DB_SSLMODE=require` is set in your `.env` (it should be).
*   **Permissions**: If you cloned to a folder other than `/opt/rm365-tools-testing`, edit `/etc/systemd/system/rm365-tools.service` to update the `WorkingDirectory`.
