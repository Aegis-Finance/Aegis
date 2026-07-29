#!/usr/bin/env node

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

async function main() {
    const artifactsDir = path.join(process.cwd(), 'artifacts', 'circuits', 'analytics');
    const wasmSrc = path.join(artifactsDir, 'analytics_js', 'analytics.wasm');
    const zkeySrc = path.join(artifactsDir, 'analytics_final.zkey');
    const outputDir = path.join(process.cwd(), 'build', 'circuits');
    const wasmDst = path.join(outputDir, 'analytics.wasm');
    const zkeyDst = path.join(outputDir, 'analytics.zkey');

    if (!fs.existsSync(wasmSrc) || !fs.existsSync(zkeySrc)) {
        console.error('Circuit artifacts not found. Run `npm run compile-circuits` to generate analytics.wasm and analytics_final.zkey.');
        process.exit(1);
    }

    await fsp.mkdir(outputDir, { recursive: true });
    await fsp.copyFile(wasmSrc, wasmDst);
    await fsp.copyFile(zkeySrc, zkeyDst);

    console.log('analytics.wasm and analytics.zkey prepared under build/circuits.');
}

if (require.main === module) {
    main().catch((error) => {
        console.error('Failed to prepare analytics circuit artifacts:', error);
        process.exit(1);
    });
}


