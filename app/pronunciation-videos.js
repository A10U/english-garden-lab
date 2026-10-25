/* Verified 2026-10-25 against the official Rachel's English creator pages below.
 * Each creator page identifies the linked YouTube video and its demonstration.
 * Links and short original Thai viewing prompts only; no media is copied. The
 * module never contacts YouTube, starts playback, or creates an iframe.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EGLPronunciationVideos = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const creator = "Rachel's English";
  const lessons = {
    frontHigh: {
      id: 'DuK3A3pBQlc',
      title: 'How to Pronounce EE vs. IH, leave vs. live — American English',
      focusThai: 'ดูปากและตำแหน่งลิ้นเทียบ seat กับ sit สำเนียงอเมริกัน วิดีโอใช้ /i/ สำหรับสระหน้าเสียงสูง ให้ดูคุณภาพสระ ไม่ใช่เพียงยาว–สั้น',
      source: 'https://rachelsenglish.com/pronounce-ee-vs-ih-leave-vs-live/'
    },
    backHigh: {
      id: 'ukKuV4fXdTA',
      title: 'How to Pronounce POOL vs. PULL: English Conversation',
      focusThai: 'ดูภาพปากระยะใกล้และช้า ๆ ของ pool กับ pull สำเนียงอเมริกัน สังเกตการห่อปาก ตำแหน่งลิ้น และเสียง l ท้ายคำ',
      source: 'https://rachelsenglish.com/how-to-pronounce-pool-vs-pull/'
    },
    frontOpen: {
      id: 'UM9gPzKs1Hg',
      title: 'American English Pronunciation: EH [ɛ] vs. AA [æ] Vowels',
      focusThai: 'ดูการอ้าปากและตำแหน่งลิ้นของ /ɛ/ กับ /æ/ แบบอเมริกัน แล้วฟังคู่ bat–bet วิดีโอใช้ /ɛ/ กับสระกลุ่ม bed',
      source: 'https://rachelsenglish.com/eh-vs-aa-vowels/'
    },
    low: {
      id: 'eJPv2mJJwHQ',
      title: 'How to Pronounce AH vs UH: American English',
      focusThai: 'ดูปากเทียบ /ɑ/ กับ /ʌ/ และฟังคู่ cop–cup แบบอเมริกัน ใช้ศึกษาสระอเมริกัน ไม่ใช่ /ɒ/ แบบอังกฤษ',
      source: 'https://rachelsenglish.com/pronounce-ah-vs-uh/'
    },
    ay: {
      id: 'XOuD6mFr6sQ',
      title: 'English Sounds – AY as in SAY Diphthong [eɪ] – How to make the AY as in SAY Diphthong [eɪ]',
      focusThai: 'ดูปากระยะใกล้ของ /eɪ/ แบบอเมริกัน สังเกตจุดเริ่มแล้วเลื่อนลิ้นสูงขึ้นในพยางค์เดียว เช่น say และ pay',
      source: 'https://rachelsenglish.com/english-pronounce-ay-diphthong/'
    },
    ai: {
      id: 'rbQtAWNFy2I',
      title: 'English Sounds – AI [aɪ] Diphthong – How to make the AI as in BUY Diphthong',
      focusThai: 'ดูการเคลื่อนลิ้นจากท่าปากอ้าไปท่าที่สูงขึ้นของ /aɪ/ แบบอเมริกัน เช่น buy และ high ไม่แยกเป็นสองพยางค์',
      source: 'https://rachelsenglish.com/english-pronounce-ai-diphthong/'
    },
    oh: {
      id: 'Civ7UBZP99M',
      title: 'English Sounds – OH [oʊ] Diphthong – How to make the OH as in NO Diphthong',
      focusThai: 'ดูจุดเริ่มและการห่อปากตอนจบของ /oʊ/ แบบอเมริกัน เช่น no และ slow วิดีโอนี้ไม่ได้สาธิต /əʊ/ แบบอังกฤษ',
      source: 'https://rachelsenglish.com/english-pronounce-oh-diphthong/'
    },
    ow: {
      id: 'i8KThVR713Q',
      title: 'English Sounds – OW [aʊ] Diphthong – How to make the OW as in NOW Diphthong',
      focusThai: 'ดูปากอ้าในตอนเริ่มแล้วค่อยห่อปากสำหรับ /aʊ/ แบบอเมริกัน เช่น now ดูช้า ๆ แล้วลองเลื่อนต่อเนื่อง',
      source: 'https://rachelsenglish.com/english-pronounce-ow-diphthong/'
    },
    oy: {
      id: '3cdSvIuTxLY',
      title: 'English Sounds – OY [ɔɪ] Diphthong – How to make the OY as in TOY Diphthong',
      focusThai: 'ดูการเริ่มด้วยปากห่อแล้วคลายปากพร้อมเลื่อนลิ้นมาด้านหน้าใน /ɔɪ/ แบบอเมริกัน เช่น toy',
      source: 'https://rachelsenglish.com/english-pronounce-oy-diphthong/'
    },
    schwa: {
      id: '2BmkUa4Mv60',
      title: 'American English Sounds – UH [ə] Vowel – How to make the SCHWA Vowel',
      focusThai: 'ดูปากที่ผ่อนคลายและฟัง /ə/ ในพยางค์ไม่เน้นของคำอเมริกัน เช่น sofa และ about อย่าเน้นทุกพยางค์เท่ากัน',
      source: 'https://rachelsenglish.com/english-pronounce-schwa/'
    }
  };
  const byPhone = new Map([
    ['ɪ', 'frontHigh'], ['i', 'frontHigh'], ['iː', 'frontHigh'],
    ['ʊ', 'backHigh'], ['u', 'backHigh'], ['uː', 'backHigh'],
    ['ɛ', 'frontOpen'], ['e', 'frontOpen'], ['æ', 'frontOpen'],
    ['ɑ', 'low'], ['ɑː', 'low'], ['ʌ', 'low'],
    ['eɪ', 'ay'], ['aɪ', 'ai'], ['oʊ', 'oh'], ['aʊ', 'ow'], ['ɔɪ', 'oy'], ['ə', 'schwa']
  ]);
  function normalize(value) {
    if (typeof value !== 'string' || value.length > 64 || /[<>&\u0000-\u001f]/.test(value)) return '';
    return value.normalize('NFC').trim().replace(/^[/\[\]]+|[/\[\]]+$/g, '')
      .replace(/[ˈˌ\u0361\u035c]/g, '').replace(/:/g, 'ː').trim();
  }
  function forPhone(value) {
    const key = byPhone.get(normalize(value));
    if (!key) return null;
    const item = lessons[key];
    return [{...item, creator, url: 'https://www.youtube.com/watch?v=' + item.id,
      accent: 'en-us', checked_on: '2026-10-25'}];
  }
  return Object.freeze({forPhone});
});
