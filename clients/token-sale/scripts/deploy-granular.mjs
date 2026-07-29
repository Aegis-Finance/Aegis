import Bundlr from '@bundlr-network/client';
import fs from 'fs';
import path from 'path';

const KEY_FILE = 'temp_deploy_key.txt';
const DIST_DIR = 'dist';
const BUNDLR_URL = process.env.BUNDLR_NODE_URL || "https://node1.irys.xyz";
const CURRENCY = "arbitrum";
const STATE_FILE = 'upload-state.json';
const CHUNK_THRESHOLD = 5 * 1024 * 1024; // 5MB
const CHUNK_SIZE = 6 * 1024 * 1024; // 6MB chunks

// Ensure sufficient Bundlr funds for a given payload size
async function ensureFunds(bundlr, byteSize) {
    try {
        const price = await bundlr.getPrice(byteSize);
        const loaded = await bundlr.getLoadedBalance();
        const toBI = (x) => {
            if (typeof x === 'bigint') return x;
            if (typeof x === 'number') return BigInt(Math.floor(x));
            if (typeof x === 'string') return BigInt(x);
            if (x && typeof x.toString === 'function') return BigInt(x.toString());
            throw new Error('Unsupported numeric type');
        };
        const p = toBI(price);
        const l = toBI(loaded);
        if (l < p) {
            const needed = p - l;
            const buffer = (needed * 10n) / 100n; // +10% buffer
            const fundAmount = needed + buffer;
            console.log(`\n⛽ Insufficient funds: need ${bundlr.utils.unitConverter(p.toString())} ETH, have ${bundlr.utils.unitConverter(l.toString())} ETH`);
            console.log(`🔌 Funding Bundlr with ${bundlr.utils.unitConverter(fundAmount.toString())} ETH...`);
            await bundlr.fund(fundAmount.toString());
            const after = await bundlr.getLoadedBalance();
            console.log(`✅ New Bundlr Balance: ${bundlr.utils.unitConverter(after)} ETH`);
        }
    } catch (err) {
        console.log(`⚠️ Funding check failed: ${err.message}`);
    }
}

// Helper to get all files recursively
function getAllFiles(dirPath, arrayOfFiles) {
    const files = fs.readdirSync(dirPath);
    arrayOfFiles = arrayOfFiles || [];

    files.forEach(function(file) {
        if (fs.statSync(dirPath + "/" + file).isDirectory()) {
            arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
        } else {
            arrayOfFiles.push(path.join(dirPath, "/", file));
        }
    });

    return arrayOfFiles;
}

// Helper for mime types
function getContentType(filename) {
    const ext = path.extname(filename).toLowerCase();
    switch (ext) {
        case '.html': return 'text/html';
        case '.js': return 'application/javascript';
        case '.css': return 'text/css';
        case '.json': return 'application/json';
        case '.png': return 'image/png';
        case '.jpg': case '.jpeg': return 'image/jpeg';
        case '.svg': return 'image/svg+xml';
        case '.wasm': return 'application/wasm';
        case '.txt': return 'text/plain';
        case '.ico': return 'image/x-icon';
        case '.webmanifest': return 'application/manifest+json';
        default: return 'application/octet-stream';
    }
}

async function uploadWithRetry(bundlr, data, tags, retries = 5) {
    for (let i = 0; i < retries; i++) {
        try {
            let tx;
            if (data.length > CHUNK_THRESHOLD && bundlr?.uploader?.chunkedUploader) {
                const uploader = bundlr.uploader.chunkedUploader;
                tx = await uploader.uploadData(data, { tags, chunkSize: CHUNK_SIZE });
            } else {
                tx = await bundlr.upload(data, { tags });
            }
            return tx.id;
        } catch (error) {
            console.log(`\n⚠️ Upload failed (attempt ${i + 1}/${retries}). Retrying in 3s...`);
            console.log(`   Reason: ${error?.message || error}`);
            if (i === retries - 1) throw error;
            await new Promise(r => setTimeout(r, 3000));
        }
    }
}

async function main() {
    try {
        console.log("🚀 Starting Robust Granular Deployment...");

        if (!fs.existsSync(KEY_FILE)) {
            throw new Error(`Key file ${KEY_FILE} not found`);
        }
        let key = fs.readFileSync(KEY_FILE, 'utf-8').trim();

        // Increase timeout to 5 minutes (300000ms)
        const bundlr = new Bundlr(BUNDLR_URL, CURRENCY, key, { timeout: 300000 });
        console.log(`Address: ${bundlr.address}`);
        
        const balance = await bundlr.getLoadedBalance();
        console.log(`Bundlr Balance: ${bundlr.utils.unitConverter(balance)} ETH`);

        const files = getAllFiles(DIST_DIR);
        console.log(`Found ${files.length} files to upload.`);

        // Load existing state
        let state = {};
        if (fs.existsSync(STATE_FILE)) {
            state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
            console.log(`Loaded ${Object.keys(state).length} previously uploaded files from state.`);
        }

        // Pre-fund for remaining files (sum bytes)
        const remainingBytes = files
            .map(fp => ({ fp, rel: path.relative(DIST_DIR, fp).replace(/\\/g, '/') }))
            .filter(({ rel }) => !state[rel])
            .reduce((acc, { fp }) => acc + fs.statSync(fp).size, 0);
        if (remainingBytes > 0) {
            // +20% buffer to cover manifest upload and overhead
            const buffered = Math.floor(remainingBytes * 1.2);
            await ensureFunds(bundlr, buffered);
        }

        // 1. Upload files individually
        for (const [index, filePath] of files.entries()) {
            const relPath = path.relative(DIST_DIR, filePath).replace(/\\/g, '/');
            const contentType = getContentType(filePath);
            
            // Skip unnecessary artifacts for token distribution
            if (relPath.startsWith('circuits/crowdfunding/')) {
                console.log(`[${index + 1}/${files.length}] ${relPath} (${contentType}) ⏭️ Skipped (Not required for token distribution)`);
                continue;
            }
            
            process.stdout.write(`[${index + 1}/${files.length}] ${relPath} (${contentType}) `);

            if (state[relPath]) {
                console.log(`✅ Skipped (Already uploaded: ${state[relPath]})`);
                continue;
            }
            
            process.stdout.write(`... Uploading ... `);
            
            try {
                const data = fs.readFileSync(filePath);
                const tags = [{ name: "Content-Type", value: contentType }];
                
                // Make sure we have enough funds for this upload
                await ensureFunds(bundlr, data.length);
                
                const id = await uploadWithRetry(bundlr, data, tags);
                console.log(`✅ ID: ${id}`);
                
                // Update state
                state[relPath] = id;
                fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
                
            } catch (err) {
                console.log(`❌ Failed`);
                console.error(err?.message || err); // Print cleaner error
                // Don't exit, try next file? No, we need all files.
                process.exit(1);
            }
        }

        // 2. Generate and Upload Manifest
        console.log("Generating manifest...");
        const manifest = {
            manifest: "arweave/paths",
            version: "0.1.0",
            index: {
                path: "index.html"
            },
            paths: {}
        };

        // Map state IDs to manifest paths
        for (const [p, id] of Object.entries(state)) {
            manifest.paths[p] = { id: id };
        }

        const manifestData = JSON.stringify(manifest);
        const manifestTags = [
            { name: "Content-Type", value: "application/x.arweave-manifest+json" }
        ];

        console.log("Uploading manifest...");
        const manifestTx = await bundlr.upload(manifestData, { tags: manifestTags });
        
        console.log("\n🎉 Deployment Complete!");
        console.log(`Manifest ID: ${manifestTx.id}`);
        console.log(`\n👉 Live URL: https://arweave.net/${manifestTx.id}`);
        
        fs.writeFileSync('deploy_manifest.txt', manifestTx.id);

    } catch (error) {
        console.error("Fatal error:", error);
        process.exit(1);
    }
}

main();
