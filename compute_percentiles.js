#!/usr/bin/env node
'use strict';

// CStanding Percentile Updater
// Reads the RaiderIO binary lookup, computes exact percentile cutoff scores,
// and patches them directly into CStanding.lua.

const fs   = require('fs');
const path = require('path');

const ADDON_DIR   = path.dirname(process.execPath.endsWith('.exe') ? process.execPath : __filename);
const WOW_ADDONS  = 'C:\\Program Files (x86)\\World of Warcraft\\_retail_\\Interface\\AddOns';
const LOOKUP_FILE = path.join(WOW_ADDONS, 'RaiderIO', 'db', 'db_mythicplus_us_lookup.lua');
const ADDON_LUA   = path.join(WOW_ADDONS, 'CStanding', 'CStanding.lua');

const RECORD_SIZE        = 30;
const PERCENTILE_TARGETS = [0.1, 0.5, 1.0, 2.5, 5.0, 10.0];

// ─── Lua string decoder ───────────────────────────────────────────────────
function decodeLuaString(raw) {
    const out = Buffer.allocUnsafe(raw.length);
    let w = 0, i = 0;
    while (i < raw.length) {
        if (raw[i] !== '\\') { out[w++] = raw.charCodeAt(i++); continue; }
        i++;
        const c = raw[i];
        if (c >= '0' && c <= '9') {
            let n = raw.charCodeAt(i++) - 48;
            if (i < raw.length && raw[i] >= '0' && raw[i] <= '9') {
                n = n * 10 + (raw.charCodeAt(i++) - 48);
                if (i < raw.length && raw[i] >= '0' && raw[i] <= '9')
                    n = n * 10 + (raw.charCodeAt(i++) - 48);
            }
            out[w++] = n & 0xFF;
        } else if (c === 'n')  { out[w++] = 10; i++; }
        else if (c === 'r')    { out[w++] = 13; i++; }
        else if (c === 't')    { out[w++] =  9; i++; }
        else if (c === 'a')    { out[w++] =  7; i++; }
        else if (c === 'b')    { out[w++] =  8; i++; }
        else if (c === 'f')    { out[w++] = 12; i++; }
        else if (c === 'v')    { out[w++] = 11; i++; }
        else if (c === '\\')   { out[w++] = 92; i++; }
        else if (c === '"')    { out[w++] = 34; i++; }
        else if (c === "'")    { out[w++] = 39; i++; }
        else if (c === 'z') {
            i++;
            while (i < raw.length && ' \t\n\r'.includes(raw[i])) i++;
        } else { out[w++] = raw.charCodeAt(i++); }
    }
    return out.slice(0, w);
}

// ─── Chunk extractor ──────────────────────────────────────────────────────
function extractChunks(fileContent) {
    const chunks = [];
    let searchFrom = 0;
    while (true) {
        const markerIdx = fileContent.indexOf('provider.lookup[', searchFrom);
        if (markerIdx === -1) break;
        const bracketClose = fileContent.indexOf(']', markerIdx + 16);
        const chunkIdx     = parseInt(fileContent.slice(markerIdx + 16, bracketClose), 10);
        const quoteOpen    = fileContent.indexOf('"', bracketClose) + 1;
        let pos = quoteOpen;
        while (pos < fileContent.length) {
            const ch = fileContent[pos];
            if (ch === '"') break;
            if (ch === '\\') {
                pos++;
                const next = fileContent[pos];
                if (next >= '0' && next <= '9') {
                    pos++;
                    if (pos < fileContent.length && fileContent[pos] >= '0' && fileContent[pos] <= '9') {
                        pos++;
                        if (pos < fileContent.length && fileContent[pos] >= '0' && fileContent[pos] <= '9') pos++;
                    }
                } else { pos++; }
            } else { pos++; }
        }
        chunks.push({ idx: chunkIdx, buf: decodeLuaString(fileContent.slice(quoteOpen, pos)) });
        searchFrom = pos + 1;
    }
    chunks.sort((a, b) => a.idx - b.idx);
    return chunks.map(c => c.buf);
}

// ─── Patch CStanding.lua ─────────────────────────────────────────────────
function patchAddonFile(cutoffs, totalRecords, date) {
    const lua = fs.readFileSync(ADDON_LUA, 'utf8');

    const header =
        `-- Percentile thresholds for Midnight Season 1 (US region, ${totalRecords.toLocaleString()} tracked chars)\n` +
        `-- Computed from RaiderIO binary lookup by CStanding Updater on ${date}.\n` +
        `-- Re-run UpdateStandings.exe after each RaiderIO update to keep these current.`;

    let table = 'local PERCENTILES = {\n';
    for (const { pct, score } of cutoffs) {
        table += `    { pct = ${String(pct).padStart(4)},  score = ${String(score).padStart(4)} },\n`;
    }
    table += '}';

    const block = header + '\n' + '-- ' + '─'.repeat(76) + '\n' + table;

    // Replace everything from the comment block down to the closing }
    const replaced = lua.replace(
        /-- Percentile thresholds[\s\S]*?^local PERCENTILES = \{[\s\S]*?\}/m,
        block
    );

    if (replaced === lua) {
        throw new Error('Could not locate PERCENTILES block in CStanding.lua — pattern not matched.');
    }

    fs.writeFileSync(ADDON_LUA, replaced, 'utf8');
}

// ─── Main ─────────────────────────────────────────────────────────────────
function main() {
    console.log('=== CStanding Percentile Updater ===\n');

    // 1. Read and decode the RaiderIO lookup
    console.log('Reading RaiderIO lookup...');
    if (!fs.existsSync(LOOKUP_FILE)) {
        console.error('ERROR: RaiderIO lookup file not found:\n  ' + LOOKUP_FILE);
        process.exit(1);
    }
    const fileContent = fs.readFileSync(LOOKUP_FILE, 'latin1');
    console.log('  File size : ' + (fileContent.length / 1024 / 1024).toFixed(1) + ' MB');

    const buffers = extractChunks(fileContent);
    if (buffers.length === 0) {
        console.error('ERROR: No lookup chunks found in the file.');
        process.exit(1);
    }

    const data = Buffer.concat(buffers);
    const totalRecords = Math.floor(data.length / RECORD_SIZE);
    console.log('  Characters: ' + totalRecords.toLocaleString());

    // 2. Extract scores (first 13 bits of each 30-byte record)
    console.log('\nDecoding scores...');
    const scores = new Uint16Array(totalRecords);
    for (let i = 0; i < totalRecords; i++) {
        const base = i * RECORD_SIZE;
        scores[i] = data[base] | ((data[base + 1] & 0x1F) << 8);
    }

    scores.sort();

    let firstNonZero = 0;
    while (firstNonZero < totalRecords && scores[firstNonZero] === 0) firstNonZero++;

    console.log('  Score range: ' + scores[firstNonZero] + ' – ' + scores[totalRecords - 1]);

    // 3. Compute cutoffs
    const cutoffs = PERCENTILE_TARGETS.map(pct => ({
        pct,
        score: scores[Math.floor(totalRecords * (1 - pct / 100))],
    }));

    console.log('\nPercentile cutoffs:');
    for (const { pct, score } of cutoffs) {
        console.log('  Top ' + String(pct).padEnd(5) + '% → ' + score);
    }

    // 4. Patch CStanding.lua
    console.log('\nUpdating CStanding.lua...');
    if (!fs.existsSync(ADDON_LUA)) {
        console.error('ERROR: CStanding.lua not found:\n  ' + ADDON_LUA);
        process.exit(1);
    }

    const date = new Date().toISOString().slice(0, 10);
    patchAddonFile(cutoffs, totalRecords, date);

    console.log('  Done! Reload your UI in-game (/reload) to apply.\n');
}

main();
