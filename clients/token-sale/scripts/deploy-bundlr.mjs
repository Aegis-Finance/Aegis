import Bundlr from '@bundlr-network/client';
import fs from 'fs';
import path from 'path';

const KEY_FILE = 'temp_deploy_key.txt';
const DIST_DIR = 'dist';

async function main() {
    try {
        if (!fs.existsSync(KEY_FILE)) {
            throw new Error(`Key file ${KEY_FILE} not found`);
        }
        let key = fs.readFileSync(KEY_FILE, 'utf-8').trim();
        
        console.log("Initializing Bundlr for Arbitrum...");
        const bundlr = new Bundlr("https://node1.bundlr.network", "arbitrum", key);
        
        console.log(`Wallet address: ${bundlr.address}`);
        
        const balance = await bundlr.getLoadedBalance();
        console.log(`Balance: ${bundlr.utils.unitConverter(balance)} ETH`);

        // Test upload
        console.log("Testing connectivity with small upload...");
        try {
            const receipt = await bundlr.upload("Ping");
            console.log(`Test upload successful. ID: ${receipt.id}`);
        } catch (e) {
            console.error("Test upload failed. Check funds or connection.", e);
            process.exit(1);
        }
        
        console.log("Uploading directory 'dist'...");
        const response = await bundlr.uploadFolder(DIST_DIR, {
            indexFile: "index.html",
            batchSize: 3, // Reduced batch size
            keepDeleted: false,
        });

        if (response && response.id) {
            console.log("Upload successful!");
            console.log(`Manifest ID: ${response.id}`);
            console.log(`URL: https://arweave.net/${response.id}`);
            fs.writeFileSync('deploy_manifest.txt', response.id);
        } else {
            console.error("Upload failed: No manifest ID returned.");
        }

    } catch (error) {
        console.error("Error during deployment:", error);
        process.exit(1);
    }
}

main();
