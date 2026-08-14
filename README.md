# 📱 Local Polling WhatsApp Gateway (100% Free)

This is a background service that connects your personal WhatsApp account to your license server database. It automatically polls the database for unsent OTPs and delivers them directly to your customers' WhatsApp numbers.

---

## 🚀 Setup Instructions (Local PC)

### 1. Install Node.js
Make sure Node.js is installed on your local computer. If not, download and install it from [nodejs.org](https://nodejs.org/).

### 2. Install Project Dependencies
Open your command terminal, navigate to this folder, and run:
```bash
npm install
```

### 3. Run the Gateway
Start the service by running:
```bash
npm start
```

### 4. Scan the QR Code
1. A QR code will generate in your command terminal.
2. Open WhatsApp on your phone ➔ **Settings** ➔ **Linked Devices** ➔ **Link a Device**.
3. Scan the terminal QR code.
4. You will see `[GATEWAY] WhatsApp Client is ready!` once authenticated.

---

## ☁️ Deploy 24/7 for Free on Koyeb

To run the gateway permanently in the cloud so it works even when your laptop is turned off:

1. **Upload code to GitHub**: Create a private GitHub repository and upload the files inside the `whatsapp-gateway` folder (including `Dockerfile`, `package.json`, `gateway.js`, etc.).
2. **Create a Koyeb Account**: Sign up at [Koyeb.com](https://www.koyeb.com/).
3. **Deploy App**:
   - Click **Create Service**.
   - Select **GitHub** as the source.
   - Choose your repository.
   - Under **Builder**, select **Dockerfile** (it will auto-detect your custom `Dockerfile`).
   - Click **Deploy**.
4. **Scan the QR Code via Koyeb Logs**:
   - Go to your service on Koyeb ➔ click **Console** or **Runtime Logs**.
   - You will see the QR code print in the online logs.
   - Scan the QR code once from your phone's WhatsApp. It will run 24/7 in the cloud.

---

## ⚙️ Configuration

Open `gateway.js` to change the polling parameters if needed:
- `LICENSE_SERVER_URL`: The URL to your hosted `get_pending.php` API.
- `POLL_INTERVAL_MS`: How often to query the database (default: `5000` ms / 5 seconds).
- `SEND_DELAY_MS`: Delay between messages to avoid spam blocks (default: `3000` ms / 3 seconds).

