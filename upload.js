import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get command line arguments
const token = process.argv[2];
const repo = process.argv[3]; // format: "username/repo-name"

if (!token || !repo) {
    console.error('❌ Error: Missing parameters.');
    console.log('Usage: node upload.js <YOUR_GITHUB_TOKEN> <GITHUB_USERNAME>/<REPO_NAME>');
    process.exit(1);
}

const filesToUpload = ['gateway.js', 'package.json', 'Dockerfile', 'README.md'];

async function uploadFile(fileName) {
    const filePath = path.join(__dirname, fileName);
    if (!fs.existsSync(filePath)) {
        console.warn(`⚠️ Warning: File ${fileName} not found. Skipping.`);
        return;
    }

    console.log(`[UPLOAD] Preparing ${fileName}...`);
    const fileContent = fs.readFileSync(filePath);
    const base64Content = fileContent.toString('base64');

    const url = `https://api.github.com/repos/${repo}/contents/${fileName}`;

    try {
        // Check if file already exists to get its SHA (needed for updates)
        let sha = null;
        const checkResponse = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github+json'
            }
        });
        
        if (checkResponse.ok) {
            const fileData = await checkResponse.json();
            sha = fileData.sha;
        }

        // Upload/Update the file
        const body = {
            message: `Upload ${fileName} via NexaCaisse Gateway Tool`,
            content: base64Content
        };
        if (sha) {
            body.sha = sha;
        }

        const uploadResponse = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github+json',
                'Content-Type': 'application/json',
                'User-Agent': 'NexaCaisse-Gateway-Uploader'
            },
            body: JSON.stringify(body)
        });

        if (uploadResponse.ok) {
            console.log(`✅ Success: ${fileName} uploaded.`);
        } else {
            const errData = await uploadResponse.json();
            console.error(`❌ Failed to upload ${fileName}:`, errData.message);
        }
    } catch (err) {
        console.error(`❌ Error uploading ${fileName}:`, err.message);
    }
}

async function main() {
    console.log(`🚀 Starting upload to repository: https://github.com/${repo}`);
    for (const file of filesToUpload) {
        await uploadFile(file);
    }
    console.log('🏁 Upload process finished.');
}

main();
