/* Whole unmodified human IPA vowel recordings; assets/vowels/ATTRIBUTION.md.
 * Illustrative vowel quality, not English duration or a learner score.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.EGLVowelAudio = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const recordings = {
  "ɪ": {
    "symbol": "ɪ",
    "audioSymbol": "ɪ",
    "url": "assets/vowels/vowel-ih.ogg",
    "caption": "เสียงสระ /ɪ/ ที่มนุษย์บันทึกแยกตามสัญลักษณ์ IPA",
    "note": "ฟังคุณภาพเสียงสระ ไม่ใช่ชื่อภาษาอังกฤษของตัวอักษร และไม่ใช่คำที่ตัดมาจากประโยค",
    "author": "Denelson83",
    "source": "https://commons.wikimedia.org/wiki/File:Near-close_near-front_unrounded_vowel.ogg",
    "license": "CC BY-SA 3.0",
    "licenseURL": "https://creativecommons.org/licenses/by-sa/3.0/"
  },
  "i": {
    "symbol": "i",
    "audioSymbol": "i",
    "url": "assets/vowels/vowel-i.ogg",
    "caption": "เสียงสระ /i/ ที่มนุษย์บันทึกแยกตามสัญลักษณ์ IPA",
    "note": "ฟังคุณภาพเสียงสระ ไม่ใช่ชื่อภาษาอังกฤษของตัวอักษร และไม่ใช่คำที่ตัดมาจากประโยค ตัวอย่างสระอ้างอิง /i/ ไม่ได้กำหนดความยาวของ /iː/ ในภาษาอังกฤษ",
    "author": "Denelson83",
    "source": "https://commons.wikimedia.org/wiki/File:Close_front_unrounded_vowel.ogg",
    "license": "CC BY-SA 3.0",
    "licenseURL": "https://creativecommons.org/licenses/by-sa/3.0/"
  },
  "ʊ": {
    "symbol": "ʊ",
    "audioSymbol": "ʊ",
    "url": "assets/vowels/vowel-uh.ogg",
    "caption": "เสียงสระ /ʊ/ ที่มนุษย์บันทึกแยกตามสัญลักษณ์ IPA",
    "note": "ฟังคุณภาพเสียงสระ ไม่ใช่ชื่อภาษาอังกฤษของตัวอักษร และไม่ใช่คำที่ตัดมาจากประโยค",
    "author": "Denelson83",
    "source": "https://commons.wikimedia.org/wiki/File:Near-close_near-back_rounded_vowel.ogg",
    "license": "CC BY-SA 3.0",
    "licenseURL": "https://creativecommons.org/licenses/by-sa/3.0/"
  },
  "u": {
    "symbol": "u",
    "audioSymbol": "u",
    "url": "assets/vowels/vowel-u.ogg",
    "caption": "เสียงสระ /u/ ที่มนุษย์บันทึกแยกตามสัญลักษณ์ IPA",
    "note": "ฟังคุณภาพเสียงสระ ไม่ใช่ชื่อภาษาอังกฤษของตัวอักษร และไม่ใช่คำที่ตัดมาจากประโยค ตัวอย่างสระอ้างอิง /u/ ไม่ได้กำหนดความยาวของ /uː/ ในภาษาอังกฤษ",
    "author": "Denelson83",
    "source": "https://commons.wikimedia.org/wiki/File:Close_back_rounded_vowel.ogg",
    "license": "CC BY-SA 3.0",
    "licenseURL": "https://creativecommons.org/licenses/by-sa/3.0/"
  },
  "ɛ": {
    "symbol": "ɛ",
    "audioSymbol": "ɛ",
    "url": "assets/vowels/vowel-epsilon.ogg",
    "caption": "เสียงสระ /ɛ/ ที่มนุษย์บันทึกแยกตามสัญลักษณ์ IPA",
    "note": "ฟังคุณภาพเสียงสระ ไม่ใช่ชื่อภาษาอังกฤษของตัวอักษร และไม่ใช่คำที่ตัดมาจากประโยค",
    "author": "Terfili; Denelson83 (original file credit)",
    "source": "https://commons.wikimedia.org/wiki/File:Open-mid_front_unrounded_vowel.ogg",
    "license": "CC BY-SA 3.0",
    "licenseURL": "https://creativecommons.org/licenses/by-sa/3.0/"
  },
  "æ": {
    "symbol": "æ",
    "audioSymbol": "æ",
    "url": "assets/vowels/vowel-ae.ogg",
    "caption": "เสียงสระ /æ/ ที่มนุษย์บันทึกแยกตามสัญลักษณ์ IPA",
    "note": "ฟังคุณภาพเสียงสระ ไม่ใช่ชื่อภาษาอังกฤษของตัวอักษร และไม่ใช่คำที่ตัดมาจากประโยค",
    "author": "Denelson83 (file-page credit); Fête (current-version upload)",
    "source": "https://commons.wikimedia.org/wiki/File:Near-open_front_unrounded_vowel.ogg",
    "license": "CC BY-SA 3.0",
    "licenseURL": "https://creativecommons.org/licenses/by-sa/3.0/"
  },
  "ʌ": {
    "symbol": "ʌ",
    "audioSymbol": "ʌ",
    "url": "assets/vowels/vowel-strut.ogg",
    "caption": "เสียงสระ /ʌ/ ที่มนุษย์บันทึกแยกตามสัญลักษณ์ IPA",
    "note": "ฟังคุณภาพเสียงสระ ไม่ใช่ชื่อภาษาอังกฤษของตัวอักษร และไม่ใช่คำที่ตัดมาจากประโยค เสียง /ʌ/ ในตาราง IPA ไม่ใช่เสียง STRUT แบบเดียวที่ใช้กับภาษาอังกฤษทุกสำเนียง",
    "author": "Denelson83",
    "source": "https://commons.wikimedia.org/wiki/File:Open-mid_back_unrounded_vowel.ogg",
    "license": "CC BY-SA 3.0",
    "licenseURL": "https://creativecommons.org/licenses/by-sa/3.0/"
  },
  "ɑ": {
    "symbol": "ɑ",
    "audioSymbol": "ɑ",
    "url": "assets/vowels/vowel-alpha.ogg",
    "caption": "เสียงสระ /ɑ/ ที่มนุษย์บันทึกแยกตามสัญลักษณ์ IPA",
    "note": "ฟังคุณภาพเสียงสระ ไม่ใช่ชื่อภาษาอังกฤษของตัวอักษร และไม่ใช่คำที่ตัดมาจากประโยค ตัวอย่างนี้ไม่ได้ระบุความยาวแบบเครื่องหมาย ː",
    "author": "Denelson83",
    "source": "https://commons.wikimedia.org/wiki/File:Open_back_unrounded_vowel.ogg",
    "license": "CC BY-SA 3.0",
    "licenseURL": "https://creativecommons.org/licenses/by-sa/3.0/"
  },
  "ə": {
    "symbol": "ə",
    "audioSymbol": "ə",
    "url": "assets/vowels/vowel-schwa.ogg",
    "caption": "เสียงสระ /ə/ ที่มนุษย์บันทึกแยกตามสัญลักษณ์ IPA",
    "note": "ฟังคุณภาพเสียงสระ ไม่ใช่ชื่อภาษาอังกฤษของตัวอักษร และไม่ใช่คำที่ตัดมาจากประโยค",
    "author": "Denelson83",
    "source": "https://commons.wikimedia.org/wiki/File:Schwa.ogg",
    "license": "CC BY-SA 3.0",
    "licenseURL": "https://creativecommons.org/licenses/by-sa/3.0/"
  },
  "ɔ": {
    "symbol": "ɔ",
    "audioSymbol": "ɔ",
    "url": "assets/vowels/vowel-open-o.ogg",
    "caption": "เสียงสระ /ɔ/ ที่มนุษย์บันทึกแยกตามสัญลักษณ์ IPA",
    "note": "ฟังคุณภาพเสียงสระ ไม่ใช่ชื่อภาษาอังกฤษของตัวอักษร และไม่ใช่คำที่ตัดมาจากประโยค ตัวอย่างนี้ไม่ได้ระบุความยาวแบบเครื่องหมาย ː",
    "author": "Denelson83",
    "source": "https://commons.wikimedia.org/wiki/File:Open-mid_back_rounded_vowel.ogg",
    "license": "CC BY-SA 3.0",
    "licenseURL": "https://creativecommons.org/licenses/by-sa/3.0/"
  },
  "ɒ": {
    "symbol": "ɒ",
    "audioSymbol": "ɒ",
    "url": "assets/vowels/vowel-open-back-rounded.ogg",
    "caption": "เสียงสระ /ɒ/ ที่มนุษย์บันทึกแยกตามสัญลักษณ์ IPA",
    "note": "ฟังคุณภาพเสียงสระ ไม่ใช่ชื่อภาษาอังกฤษของตัวอักษร และไม่ใช่คำที่ตัดมาจากประโยค",
    "author": "Denelson83",
    "source": "https://commons.wikimedia.org/wiki/File:Open_back_rounded_vowel.ogg",
    "license": "CC BY-SA 3.0",
    "licenseURL": "https://creativecommons.org/licenses/by-sa/3.0/"
  },
  "ɜ": {
    "symbol": "ɜ",
    "audioSymbol": "ɜ",
    "url": "assets/vowels/vowel-open-central.ogg",
    "caption": "เสียงสระ /ɜ/ ที่มนุษย์บันทึกแยกตามสัญลักษณ์ IPA",
    "note": "ฟังคุณภาพเสียงสระ ไม่ใช่ชื่อภาษาอังกฤษของตัวอักษร และไม่ใช่คำที่ตัดมาจากประโยค ตัวอย่างนี้ไม่ได้ระบุความยาวแบบเครื่องหมาย ː",
    "author": "Denelson83",
    "source": "https://commons.wikimedia.org/wiki/File:Open-mid_central_unrounded_vowel.ogg",
    "license": "CC BY-SA 3.0",
    "licenseURL": "https://creativecommons.org/licenses/by-sa/3.0/"
  }
};
  const longBases = { 'iː': 'i', 'uː': 'u', 'ɑː': 'ɑ', 'ɔː': 'ɔ', 'ɜː': 'ɜ' };
  function forPhone(phone) {
    if (typeof phone !== 'string') return null;
    const symbol = phone.normalize('NFC').trim().replace(/^[\/\[]+|[\/\]]+$/gu, '').replace(/[ˈˌ͜͡]/gu, '').replace(/:/g, 'ː');
    const base = symbol === 'e' ? 'ɛ' : Object.prototype.hasOwnProperty.call(longBases, symbol) ? longBases[symbol] : symbol;
    if (!Object.prototype.hasOwnProperty.call(recordings, base)) return null;
    const entry = { ...recordings[base], symbol };
    if (symbol === 'e') entry.note += ' พจนานุกรมอังกฤษบางเล่มใช้ /e/ แทนสระของ bed; ไฟล์นี้เป็นเสียง /ɛ/ ไม่ใช่สระอ้างอิงมาตรฐาน [e] ซึ่งมีตำแหน่งลิ้นต่างกัน';
    else if (base !== symbol) entry.note += ' ใช้ฟังคุณภาพของ /' + base + '/ ประกอบ /' + symbol + '/ เท่านั้น ไฟล์นี้ไม่ได้ยืนยันระยะเสียงยาวแบบอังกฤษ';
    return entry;
  }
  return Object.freeze({ forPhone });
});
