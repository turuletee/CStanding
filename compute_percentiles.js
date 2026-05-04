#!/usr/bin/env node
'use strict';

// CStanding Percentile Updater
// Reads the RaiderIO binary lookup, builds an exact score→percentile map
// from the full character histogram, and patches it into CStanding.lua.

const fs   = require('fs');
const path = require('path');

const WOW_ADDONS  = 'C:\\Program Files (x86)\\World of Warcraft\\_retail_\\Interface\\AddOns';
const LOOKUP_FILE = path.join(WOW_ADDONS, 'RaiderIO', 'db', 'db_mythicplus_us_lookup.lua');
const ADDON_LUA   = path.join(WOW_ADDONS, 'CStanding', 'CStanding.lua');

const RECORD_SIZE   = 30;
const BLOCK_START   = '-- [[CStanding:dist:start]]';
const BLOCK_END     = '-- [[CStanding:dist:end]]';
const MAX_PCT       = 10.5;   // include scores up to this percentile in the table

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
function patchAddonFile(luaTable, totalRecords, date) {
    const lua = fs.readFileSync(ADDON_LUA, 'utf8');

    const block = [
        BLOCK_START,
        `-- Score distribution for Midnight Season 1 (US region, ${totalRecords.toLocaleString()} tracked chars)`,
        `-- Computed from RaiderIO binary lookup by CStanding Updater on ${date}.`,
        `-- Re-run UpdateStandings.exe after each RaiderIO update to keep these current.`,
        `-- score -> top percentile (stored at 2dp, displayed at 1dp). Top ~10% range only.`,
        `local SCORE_DIST = {`,
        luaTable,
        `}`,
        BLOCK_END,
    ].join('\n');

    const escaped = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped(BLOCK_START) + '[\\s\\S]*?' + escaped(BLOCK_END));

    if (!pattern.test(lua)) {
        throw new Error('Could not locate distribution block in CStanding.lua.\nMake sure the sentinel comments are present.');
    }

    fs.writeFileSync(ADDON_LUA, lua.replace(pattern, block), 'utf8');
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

    // 2. Build score histogram (first 13 bits of each 30-byte record)
    console.log('\nBuilding score histogram...');
    const histogram = new Uint32Array(8192); // 13-bit scores: 0–8191
    for (let i = 0; i < totalRecords; i++) {
        const base = i * RECORD_SIZE;
        histogram[data[base] | ((data[base + 1] & 0x1F) << 8)]++;
    }

    // Find actual max score
    let maxScore = 0;
    for (let s = 8191; s >= 0; s--) {
        if (histogram[s] > 0) { maxScore = s; break; }
    }

    // 3. Compute cumulative top-percentile for each integer score, descending
    //    cumulative after processing score s = count of players with score >= s
    console.log('Computing distribution...');
    const distEntries = []; // [score, pct_string]
    let cumulative = 0;

    for (let s = maxScore; s >= 0; s--) {
        cumulative += histogram[s];
        const pct = cumulative / totalRecords * 100;
        if (pct > MAX_PCT) break;
        distEntries.push([s, pct.toFixed(2)]);
    }

    // distEntries is ordered high→low score (low→high pct)
    // Summary
    const topEntry  = distEntries[0];
    const botEntry  = distEntries[distEntries.length - 1];
    console.log('  Score range in table: ' + botEntry[0] + ' – ' + topEntry[0]);
    console.log('  Entries: ' + distEntries.length);
    console.log('  Sample cutoffs:');
    for (const pctTarget of [0.1, 0.5, 1, 2.5, 5, 10]) {
        const entry = distEntries.find(([, p]) => parseFloat(p) >= pctTarget);
        if (entry) console.log('    Top ' + String(pctTarget).padEnd(5) + '% → ' + entry[0]);
    }

    // 4. Build compact Lua table string
    //    One entry per line: "    [SCORE]=PCT,"
    const luaTable = distEntries
        .map(([s, p]) => `    [${s}]=${p},`)
        .join('\n');

    // 5. Patch CStanding.lua
    console.log('\nUpdating CStanding.lua...');
    if (!fs.existsSync(ADDON_LUA)) {
        console.error('ERROR: CStanding.lua not found:\n  ' + ADDON_LUA);
        process.exit(1);
    }

    const date = new Date().toISOString().slice(0, 10);
    patchAddonFile(luaTable, totalRecords, date);
    console.log('  Done! Reload your UI in-game (/reload) to apply.\n');
}

main();
