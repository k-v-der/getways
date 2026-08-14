import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';

// Configuration
const LICENSE_SERVER_URL = 'https://server-abdelkader.com/get_pending.php';
const STATUS_SERVER_URL = 'https://server-abdelkader.com/update_gateway_status.php';
const POLL_INTERVAL_MS = 5000; // Poll every 5 seconds
const SEND_DELAY_MS = 3000;     // Delay 3 seconds between messages to look natural

// Initialize WhatsApp Web Client
console.log('[GATEWAY] Starting WhatsApp Client...');

const puppeteerOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
};

// Use native Chromium path inside Docker containers (e.g. Koyeb)
if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    puppeteerOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
}

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: puppeteerOptions
});

client.on('loading_screen', (percent, message) => {
    console.log(`[GATEWAY] Loading screen: ${percent}% - ${message}`);
});

let clientState = 'initializing';
let latestQrCode = null;
let latestPairingCode = null;
let pairingError = null;

// Generate QR Code in Terminal for login
client.on('qr', (qr) => {
    latestQrCode = qr;
    clientState = 'qr_ready';
    console.log('[GATEWAY] Please scan this QR code with your phone\'s WhatsApp:');
    qrcode.generate(qr, { small: true });
});


client.on('ready', () => {
    latestQrCode = null;
    clientState = 'ready';
    const phoneNumber = client.info.wid.user;
    console.log(`[GATEWAY] WhatsApp Client is ready! Connected Number: +${phoneNumber}`);
    console.log('[GATEWAY] Starting queue poller...');
    
    // Initial status report
    reportStatus('online');
    
    // Heartbeat every 15 seconds
    setInterval(() => reportStatus('online'), 15000);
    
    startPollingLoop();
});

client.on('auth_failure', (msg) => {
    clientState = 'disconnected';
    console.error('[GATEWAY] Authentication failure:', msg);
});

client.on('disconnected', (reason) => {
    clientState = 'disconnected';
    latestQrCode = null;
    console.log('[GATEWAY] Client was logged out', reason);
});

client.initialize();

// Polling loop
function startPollingLoop() {
    setInterval(async () => {
        try {
            const resp = await fetch(LICENSE_SERVER_URL);
            const data = await resp.json();
            
            if (data.success && data.queue && data.queue.length > 0) {
                console.log(`[GATEWAY] Found ${data.queue.length} pending OTP messages.`);
                await processQueue(data.queue);
            }
        } catch (err) {
            console.error('[GATEWAY] Error polling database:', err.message);
        }
    }, POLL_INTERVAL_MS);
}

// Process pending messages sequentially
async function processQueue(messages) {
    for (const msg of messages) {
        // Format number correctly (add @c.us suffix)
        let cleanPhone = msg.phone.replace(/[+\s\-\(\)]/g, '');
        
        // Convert local Algerian numbers starting with 0 to international format
        if (cleanPhone.startsWith('0')) {
            cleanPhone = '213' + cleanPhone.substring(1);
        } else if (!cleanPhone.startsWith('213') && cleanPhone.length === 9) {
            cleanPhone = '213' + cleanPhone;
        }

        const chatId = `${cleanPhone}@c.us`;
        console.log(`[GATEWAY] Sending message to ${chatId}: "${msg.message}"`);

        try {
            await client.sendMessage(chatId, msg.message);
            console.log(`[GATEWAY] Message sent successfully. Updating queue status...`);
            await updateMessageStatus(msg.id, 'sent');
        } catch (sendErr) {
            console.error(`[GATEWAY] Failed to send message to ${msg.phone}:`, sendErr.message);
            await updateMessageStatus(msg.id, 'failed');
        }

        // Wait between messages to stay safe
        await new Promise(resolve => setTimeout(resolve, SEND_DELAY_MS));
    }
}

// Update status in PHP database queue
async function updateMessageStatus(id, status) {
    try {
        await fetch(LICENSE_SERVER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, status })
        });
    } catch (err) {
        console.error('[GATEWAY] Error updating status in database:', err.message);
    }
}

// Report connection status to server
async function reportStatus(status) {
    try {
        const phoneNumber = client.info && client.info.wid ? client.info.wid.user : 'unknown';
        await fetch(STATUS_SERVER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: phoneNumber, status })
        });
    } catch (err) {
        console.error('[GATEWAY] Error reporting status to server:', err.message);
    }
}

// Add simple HTTP health check server for cloud platforms (e.g. Koyeb, Render)
import http from 'http';
const port = process.env.PORT || 8080;
const server = http.createServer(async (req, res) => {
    // API Endpoint for AJAX status polling
    if (req.url === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: clientState,
            qr: latestQrCode ? `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(latestQrCode)}` : null,
            pairingCode: latestPairingCode,
            pairingError: pairingError
        }));
        return;
    }

    // API Endpoint to request phone pairing code
    if (req.url.startsWith('/api/link-phone')) {
        const urlObj = new URL(req.url, `http://${req.headers.host}`);
        const rawPhone = urlObj.searchParams.get('phone');
        
        if (!rawPhone) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Phone number is required' }));
            return;
        }

        let cleanPhone = rawPhone.replace(/[+\s\-\(\)]/g, '');
        if (cleanPhone.startsWith('0')) {
            cleanPhone = '213' + cleanPhone.substring(1);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        
        try {
            console.log(`[GATEWAY] Requesting pairing code for phone: ${cleanPhone}`);
            clientState = 'requesting_code';
            latestPairingCode = null;
            pairingError = null;
            
            // Trigger pairing code on WhatsApp Web
            const code = await client.requestPairingCode(cleanPhone);
            
            latestPairingCode = code;
            clientState = 'code_ready';
            console.log(`[GATEWAY] Pairing code generated: ${code}`);
            res.end(JSON.stringify({ success: true, code }));
        } catch (err) {
            console.error('[GATEWAY] Failed to request pairing code:', err.message);
            pairingError = err.message;
            clientState = 'qr_ready';
            res.end(JSON.stringify({ success: false, error: err.message }));
        }
        return;
    }

    // API Endpoint to reset/cancel pairing and show QR code again
    if (req.url === '/api/reset') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        try {
            if (client.pupPage) {
                console.log('[GATEWAY] Reloading Puppeteer page to reset QR code...');
                clientState = 'initializing';
                latestPairingCode = null;
                latestQrCode = null;
                pairingError = null;
                await client.pupPage.reload();
                res.end(JSON.stringify({ success: true }));
            } else {
                res.end(JSON.stringify({ success: false, error: 'Browser not active' }));
            }
        } catch (err) {
            res.end(JSON.stringify({ success: false, error: err.message }));
        }
        return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    
    if (clientState === 'ready') {
        res.end(`
            <html>
                <head>
                    <title>WhatsApp Gateway Active</title>
                    <style>
                        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; text-align: center; padding: 50px; background-color: #f0f2f5; color: #3b3b3b; }
                        .card { background: white; padding: 40px; border-radius: 16px; display: inline-block; box-shadow: 0 4px 20px rgba(0,0,0,0.08); max-width: 450px; }
                        .icon { font-size: 50px; color: #25D366; margin-bottom: 20px; }
                        h1 { color: #25D366; margin-top: 0; font-weight: 700; }
                        p { font-size: 16px; line-height: 1.5; color: #606770; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <div class="icon">✓</div>
                        <h1>Gateway is Active</h1>
                        <p>The client is connected and successfully logged in to WhatsApp. OTP messages are being processed.</p>
                    </div>
                </body>
            </html>
        `);
    } else if (clientState === 'qr_ready' && latestQrCode) {
        const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(latestQrCode)}`;
        res.end(`
            <html>
                <head>
                    <title>WhatsApp Gateway Login</title>
                    <style>
                        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; text-align: center; padding: 50px; background-color: #f0f2f5; color: #3b3b3b; }
                        .card { background: white; padding: 40px; border-radius: 16px; display: inline-block; box-shadow: 0 4px 20px rgba(0,0,0,0.08); max-width: 450px; }
                        img { margin: 20px 0; border: 1px solid #e1e4e8; padding: 12px; background: white; border-radius: 8px; }
                        h1 { color: #25D366; margin-top: 0; font-weight: 700; }
                        p { font-size: 16px; line-height: 1.5; color: #606770; }
                        .footer { margin-top: 20px; font-size: 13px; color: #90949c; }
                        .divider { margin: 25px 0; border-top: 1px solid #e1e4e8; position: relative; }
                        .divider::after { content: "OR"; background: white; padding: 0 10px; position: absolute; top: -10px; left: 50%; transform: translateX(-50%); font-size: 12px; color: #90949c; font-weight: bold; }
                        .phone-link-section { margin-top: 10px; }
                        .phone-link-section h3 { margin: 0 0 5px 0; font-size: 16px; color: #3b3b3b; }
                        .sub-text { font-size: 13px; color: #90949c; margin: 0 0 15px 0; }
                        .input-group { display: flex; gap: 8px; justify-content: center; max-width: 320px; margin: 0 auto; }
                        .input-group input { flex: 1; padding: 10px 14px; border: 1px solid #ccd0d5; border-radius: 8px; font-size: 14px; outline: none; }
                        .input-group input:focus { border-color: #25D366; box-shadow: 0 0 0 2px rgba(37,211,102,0.15); }
                        .input-group button { background-color: #25D366; color: white; border: none; padding: 10px 16px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 14px; }
                        .input-group button:hover { background-color: #20ba5a; }
                        .error-text { color: #d93025; font-size: 13px; margin-top: 10px; font-weight: 500; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <h1>Link WhatsApp</h1>
                        <p>Open WhatsApp on your phone, go to <strong>Linked Devices</strong>, and scan the QR code below:</p>
                        <img src="${qrImageUrl}" alt="WhatsApp QR Code" width="300" height="300" />
                        
                        <div class="divider"></div>
                        
                        <div class="phone-link-section">
                            <h3>Link with Phone Number Instead</h3>
                            <p class="sub-text">Get an 8-character pairing code to type into your phone.</p>
                            <div class="input-group">
                                <input type="text" id="phoneInput" placeholder="e.g. 213550123456" />
                                <button onclick="requestPairingCode()">Get Code</button>
                            </div>
                            <div id="errorText" class="error-text"></div>
                        </div>
                    </div>
                    <script>
                        let currentStatus = "qr_ready";
                        async function checkStatus() {
                            try {
                                const res = await fetch('/api/status');
                                const data = await res.json();
                                if (data.status !== currentStatus) {
                                    window.location.reload();
                                    return;
                                }
                                if (data.qr) {
                                    const img = document.querySelector('img');
                                    if (img && img.src !== data.qr) {
                                        img.src = data.qr;
                                    }
                                }
                            } catch (e) {}
                        }
                        setInterval(checkStatus, 3000);

                        async function requestPairingCode() {
                            const phoneInput = document.getElementById('phoneInput');
                            const errorText = document.getElementById('errorText');
                            const btn = document.querySelector('.input-group button');
                            const phone = phoneInput.value.trim();
                            if (!phone) {
                                errorText.innerText = "Please enter your phone number";
                                return;
                            }
                            errorText.innerText = "";
                            btn.disabled = true;
                            btn.innerText = "Please wait...";
                            try {
                                const res = await fetch('/api/link-phone?phone=' + encodeURIComponent(phone));
                                const data = await res.json();
                                if (!data.success) {
                                    errorText.innerText = data.error || "Failed to generate pairing code";
                                    btn.disabled = false;
                                    btn.innerText = "Get Code";
                                } else {
                                    window.location.reload();
                                }
                            } catch (e) {
                                errorText.innerText = "Connection error. Try again.";
                                btn.disabled = false;
                                btn.innerText = "Get Code";
                            }
                        }
                    </script>
                </body>
            </html>
        `);
    } else if (clientState === 'requesting_code') {
        res.end(`
            <html>
                <head>
                    <title>Generating Code</title>
                    <style>
                        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; text-align: center; padding: 50px; background-color: #f0f2f5; color: #3b3b3b; }
                        .card { background: white; padding: 40px; border-radius: 16px; display: inline-block; box-shadow: 0 4px 20px rgba(0,0,0,0.08); max-width: 450px; }
                        .spinner { border: 4px solid #f3f3f3; border-top: 4px solid #25D366; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 20px auto; }
                        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                        h1 { color: #3b3b3b; margin-top: 0; font-weight: 700; font-size: 22px; }
                        p { font-size: 16px; line-height: 1.5; color: #606770; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <div class="spinner"></div>
                        <h1>Generating Code...</h1>
                        <p>Requesting pairing code from WhatsApp Web. This will take just a few seconds.</p>
                    </div>
                    <script>
                        let currentStatus = "requesting_code";
                        async function checkStatus() {
                            try {
                                const res = await fetch('/api/status');
                                const data = await res.json();
                                if (data.status !== currentStatus) {
                                    window.location.reload();
                                }
                            } catch (e) {}
                        }
                        setInterval(checkStatus, 2000);
                    </script>
                </body>
            </html>
        `);
    } else if (clientState === 'code_ready') {
        res.end(`
            <html>
                <head>
                    <title>WhatsApp Pairing Code</title>
                    <style>
                        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; text-align: center; padding: 50px; background-color: #f0f2f5; color: #3b3b3b; }
                        .card { background: white; padding: 40px; border-radius: 16px; display: inline-block; box-shadow: 0 4px 20px rgba(0,0,0,0.08); max-width: 450px; }
                        h1 { color: #3b3b3b; margin-top: 0; font-weight: 700; }
                        p { font-size: 16px; line-height: 1.5; color: #606770; }
                        .pairing-code { font-size: 36px; font-weight: bold; background: #e7f8ee; color: #25D366; padding: 15px 30px; border-radius: 12px; margin: 25px 0; border: 2px dashed #25D366; letter-spacing: 4px; display: inline-block; font-family: monospace; }
                        .btn-cancel { background: transparent; color: #606770; border: 1px solid #ccd0d5; padding: 10px 20px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 14px; margin-top: 20px; }
                        .btn-cancel:hover { background: #f0f2f5; color: #3b3b3b; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <h1>Your Pairing Code</h1>
                        <div class="pairing-code">${latestPairingCode}</div>
                        <p>Open WhatsApp on your phone ➔ go to <strong>Linked Devices</strong> ➔ tap <strong>Link with phone number instead</strong> at the bottom, and enter the code above.</p>
                        
                        <button class="btn-cancel" onclick="cancelPairingCode()">Show QR Code Instead</button>
                    </div>
                    <script>
                        let currentStatus = "code_ready";
                        async function checkStatus() {
                            try {
                                const res = await fetch('/api/status');
                                const data = await res.json();
                                if (data.status !== currentStatus) {
                                    window.location.reload();
                                }
                            } catch (e) {}
                        }
                        setInterval(checkStatus, 3000);

                        async function cancelPairingCode() {
                            try {
                                document.querySelector('.btn-cancel').innerText = "Please wait...";
                                await fetch('/api/reset');
                                window.location.reload();
                            } catch (e) {
                                window.location.reload();
                            }
                        }
                    </script>
                </body>
            </html>
        `);
    } else {
        // Display initializing spinner
        res.end(`
            <html>
                <head>
                    <title>WhatsApp Gateway Loading</title>
                    <style>
                        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; text-align: center; padding: 50px; background-color: #f0f2f5; color: #3b3b3b; }
                        .card { background: white; padding: 40px; border-radius: 16px; display: inline-block; box-shadow: 0 4px 20px rgba(0,0,0,0.08); max-width: 450px; }
                        .spinner { border: 4px solid #f3f3f3; border-top: 4px solid #25D366; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 20px auto; }
                        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                        h1 { color: #3b3b3b; margin-top: 0; font-weight: 700; font-size: 22px; }
                        p { font-size: 16px; line-height: 1.5; color: #606770; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <div class="spinner"></div>
                        <h1>Initializing WhatsApp...</h1>
                        <p>Please wait while the gateway starts the secure WhatsApp Web instance. This can take up to a minute.</p>
                    </div>
                    <script>
                        let currentStatus = "initializing";
                        async function checkStatus() {
                            try {
                                const res = await fetch('/api/status');
                                const data = await res.json();
                                if (data.status !== currentStatus) {
                                    window.location.reload();
                                }
                            } catch (e) {}
                        }
                        setInterval(checkStatus, 3000);
                    </script>
                </body>
            </html>
        `);
    }
});
server.listen(port, () => {
    console.log(`[GATEWAY] Health check server listening on port ${port}`);
});
