// bech32 (BIP173) encode/decode plus Veil address validation.
// Coinbase payouts need a basecoin address (bv1 mainnet, tv1 testnet).

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values) {
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) chk ^= GEN[i];
    }
  }
  return chk;
}

function hrpExpand(hrp) {
  const out = [];
  for (const c of hrp) out.push(c.charCodeAt(0) >> 5);
  out.push(0);
  for (const c of hrp) out.push(c.charCodeAt(0) & 31);
  return out;
}

function verifyChecksum(hrp, data) {
  return polymod(hrpExpand(hrp).concat(data)) === 1;
}

function createChecksum(hrp, data) {
  const values = hrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
  const mod = polymod(values) ^ 1;
  const out = [];
  for (let p = 0; p < 6; p++) out.push((mod >> (5 * (5 - p))) & 31);
  return out;
}

function encode(hrp, data) {
  const combined = data.concat(createChecksum(hrp, data));
  return hrp + '1' + combined.map((d) => CHARSET[d]).join('');
}

function decode(addr) {
  // Veil caps bech32 at 122 chars, not BIP173's 90: stealth addresses are ~121
  if (typeof addr !== 'string' || addr.length < 8 || addr.length > 122) return null;
  const lower = addr.toLowerCase();
  if (addr !== lower && addr !== addr.toUpperCase()) return null;
  const pos = lower.lastIndexOf('1');
  if (pos < 1 || pos + 7 > lower.length) return null;
  const hrp = lower.slice(0, pos);
  for (const c of hrp) {
    const code = c.charCodeAt(0);
    if (code < 33 || code > 126) return null;
  }
  const data = [];
  for (const c of lower.slice(pos + 1)) {
    const d = CHARSET.indexOf(c);
    if (d === -1) return null;
    data.push(d);
  }
  if (!verifyChecksum(hrp, data)) return null;
  return { hrp, data: data.slice(0, -6) };
}

// 8 bit bytes to 5 bit words
function toWords(bytes) {
  let acc = 0;
  let bits = 0;
  const out = [];
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out.push((acc >> bits) & 31);
    }
  }
  if (bits > 0) out.push((acc << (5 - bits)) & 31);
  return out;
}

// 5 bit words back to bytes, strict padding rules
function fromWords(words) {
  let acc = 0;
  let bits = 0;
  const out = [];
  for (const w of words) {
    acc = (acc << 5) | w;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  if (bits >= 5 || ((acc << (8 - bits)) & 0xff)) return null;
  return out;
}

// hrp -> { network, type }. Veil: bv/tv basecoin, sv/tps stealth.
const HRP = {
  bv: { network: 'mainnet', type: 'basecoin' },
  tv: { network: 'testnet', type: 'basecoin' },
  sv: { network: 'mainnet', type: 'stealth' },
  tps: { network: 'testnet', type: 'stealth' },
};

// Validates any Veil address and reports its type. Whether a given type is
// acceptable for a pool or for solo is decided by the caller, not here:
// yadaminers takes basecoin or stealth, FastPool and solo need basecoin.
function validateVeilAddress(input) {
  const addr = String(input || '').trim();
  if (!addr) return { valid: false, reason: '' };
  const dec = decode(addr);
  if (!dec) {
    return { valid: false, reason: 'not a valid address, check for typos' };
  }
  const info = HRP[dec.hrp];
  if (!info) {
    return { valid: false, reason: 'unknown prefix "' + dec.hrp + '", expected bv1 or sv1' };
  }
  if (dec.data.length < 1) return { valid: false, reason: 'empty payload' };

  if (info.type === 'basecoin') {
    const version = dec.data[0];
    if (version !== 0) return { valid: false, reason: 'unsupported address version' };
    const program = fromWords(dec.data.slice(1));
    if (!program || (program.length !== 20 && program.length !== 32)) {
      return { valid: false, reason: 'bad payload length' };
    }
  } else {
    // stealth: whole payload is a CStealthAddress blob (~70 bytes). The
    // bech32 checksum already caught any typo; just sanity check the size.
    const blob = fromWords(dec.data);
    if (!blob || blob.length < 66) {
      return { valid: false, reason: 'bad stealth payload' };
    }
  }
  return { valid: true, network: info.network, type: info.type };
}

module.exports = { encode, decode, toWords, fromWords, validateVeilAddress };
