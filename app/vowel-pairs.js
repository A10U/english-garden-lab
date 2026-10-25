/* Original Thai listening/coaching prompts. Word pronunciations checked in
 * Cambridge Dictionary's UK/US pronunciation entries; articulatory facts use
 * the primary university resources linked below. No dictionary audio, images,
 * definitions or prose are bundled here. This catalog never plays or downloads
 * audio: the caller must check the actual recording's reference/accent first.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EGLVowelPairs = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const PAIRS = Object.create(null);
  const dictionary = word => 'https://dictionary.cambridge.org/pronunciation/english/' + word;
  const vowelSource = 'https://ecampusontario.pressbooks.pub/essentialsoflinguistics2/chapter/3-5-describing-vowels/';
  const diphthongSource = 'https://ecampusontario.pressbooks.pub/essentialsoflinguistics/chapter/2-8-diphthongs/';
  const iSource = 'https://enunciate.arts.ubc.ca/i/';
  const smallISource = 'https://enunciate.arts.ubc.ca/%C9%AA/';
  const uSource = 'https://enunciate.arts.ubc.ca/u/';
  const smallUSource = 'https://enunciate.arts.ubc.ca/%CA%8A/';
  const aeSource = 'https://enunciate.arts.ubc.ca/ae/';
  const meanings = {
    sit: 'นั่ง', seat: 'ที่นั่ง', pull: 'ดึง', pool: 'สระว่ายน้ำ', bed: 'เตียง', bad: 'ไม่ดี',
    cup: 'ถ้วย', cop: 'ตำรวจ (คำไม่เป็นทางการ)', late: 'สาย / ช้า', let: 'ยอมให้',
    bite: 'กัด', bit: 'ชิ้นเล็ก ๆ', note: 'บันทึก', not: 'ไม่', now: 'ตอนนี้', no: 'ไม่ / ไม่ใช่',
    boy: 'เด็กผู้ชาย', buy: 'ซื้อ', about: 'เกี่ยวกับ', above: 'อยู่เหนือ',
    thought: 'ความคิด', father: 'พ่อ', bird: 'นก'
  };
  function word(value, phone) { return {word: value, phone, meaning: meanings[value]}; }
  function add(target, targetWord, other, difference, steps, options) {
    const config = options || {};
    PAIRS[target] = {
      target, targetWord, other,
      title: config.title || 'ฟัง ' + targetWord.word + ' เทียบกับ ' + other.word,
      difference, steps,
      note: config.note || 'ฟังคำเต็มสลับกัน แล้วสังเกตสระกลางคำ ความต่างไม่ใช่แค่ความยาวของเสียง',
      accent: config.accent || 'en-us', exactTarget: config.exactTarget !== false,
      minimalPair: config.minimalPair !== false,
      sources: [...new Set([dictionary(targetWord.word), dictionary(other.word), ...(config.sources || [vowelSource])])]
    };
  }
  function twoWay(first, firstWord, second, secondWord, difference, steps, options) {
    add(first, word(firstWord, first), word(secondWord, second), difference, steps, options);
    add(second, word(secondWord, second), word(firstWord, first), difference, steps, options);
  }

  twoWay('ɪ', 'sit', 'iː', 'seat',
    'sit /ɪ/ ผ่อนลิ้นให้ต่ำและเข้ากลางกว่า ส่วน seat /iː/ ยกลิ้นส่วนหน้าให้สูงกว่า ทั้งคู่ไม่ห่อปาก ไม่ใช่แค่ตัดเสียง seat ให้สั้น',
    ['ฟัง sit แล้ว seat ให้จบทั้งคำ ลองบอกว่าคำไหนแปลว่า “นั่ง” และคำไหนแปลว่า “ที่นั่ง”',
      'พูด sit โดยผ่อนลิ้นลงเล็กน้อย แล้วพูด seat โดยยกลิ้นส่วนหน้าให้สูงขึ้น',
      'สลับ sit — seat ช้า ๆ โดยคงเสียงต้น /s/ และท้าย /t/ ไว้ ฟังคุณภาพของสระที่เปลี่ยน'],
    {sources: [iSource, smallISource]});
  twoWay('ʊ', 'pull', 'uː', 'pool',
    'pull /ʊ/ ลิ้นผ่อนและต่ำกว่า ห่อปากน้อยกว่าเล็กน้อย ส่วน pool /uː/ ยกลิ้นสูงและห่อปากชัดกว่า ตำแหน่งจริงอาจค่อนไปกลางตามสำเนียง',
    ['ฟัง pull “ดึง” แล้ว pool “สระว่ายน้ำ” ให้จบทั้งคำ',
      'เริ่มจาก pool แล้วผ่อนลิ้นลงและคลายปากเล็กน้อยเพื่อฝึก pull',
      'สลับ pull — pool โดยไม่เพียงยืดหรือหดระยะเสียง ฟังว่าสีเสียงของสระต่างกันอย่างไร'],
    {sources: [uSource, smallUSource]});
  twoWay('ɛ', 'bed', 'æ', 'bad',
    'bed /ɛ/ เปิดปากปานกลาง ส่วน bad /æ/ อ้าปากกว้างและลดลิ้นส่วนหน้าลงกว่า ไม่ห่อปากทั้งสองเสียง',
    ['ฟัง bed “เตียง” แล้ว bad “ไม่ดี” ให้จบทั้งคำ',
      'พูด bed แล้วค่อยอ้าปากและลดลิ้นส่วนหน้าลงเพื่อฝึก bad โดยไม่ฝืนกางขากรรไกร',
      'สลับ bed — bad ให้เสียงต้น /b/ และท้าย /d/ คงเดิม แล้วฟังว่าสระเปลี่ยนความหมายอย่างไร'],
    {note: 'พจนานุกรมบางเล่มรวมถึง Cambridge ใช้ /e/ แทนสระของ bed; คู่มือนี้ใช้ /ɛ/ เพื่อแยกจากจุดเริ่มสระเลื่อน /eɪ/', sources: [aeSource, vowelSource]});

  add('ʌ', word('cup', 'ʌ'), word('cop', 'ɑː'),
    'cup /ʌ/ ผ่อนปาก ลิ้นค่อนกลางและค่อนต่ำ ส่วน cop แบบอเมริกัน /ɑː/ อ้าปากกว้างกว่าและวางลิ้นต่ำค่อนไปด้านหลัง ทั้งสองไม่ห่อปาก',
    ['เลือกเสียงตัวอย่างอเมริกัน แล้วฟัง cup “ถ้วย” กับ cop “ตำรวจ”',
      'พูด cup แบบผ่อนปาก แล้วอ้าปากและลดลิ้นต่ำค่อนไปด้านหลังเพื่อฝึก cop',
      'สลับ cup — cop โดยคง /k/ และ /p/ ไว้ อย่าเพิ่มความยาวอย่างเดียว'],
    {note: 'คู่นี้อิงสระ cop แบบอเมริกัน /ɑ(ː)/; cop แบบอังกฤษมักเป็น /ɒ/ จึงห้ามใช้แทนกันโดยไม่ตรวจสำเนียง'});
  add('ɑː', word('cop', 'ɑː'), word('cup', 'ʌ'),
    'cop แบบอเมริกัน /ɑː/ อ้าปากกว้าง ลิ้นต่ำค่อนไปด้านหลัง ส่วน cup /ʌ/ ผ่อนปากและวางลิ้นค่อนกลางกว่า ทั้งสองไม่ห่อปาก',
    ['ฟัง cop แบบอเมริกัน แล้ว cup ให้จบทั้งคำ',
      'พูด cop โดยอ้าปากสบาย ๆ ลิ้นต่ำด้านหลัง แล้วผ่อนเข้ากลางปากเพื่อพูด cup',
      'สลับ cop — cup อย่าตัดสินจากระยะเสียงอย่างเดียว'],
    {note: 'ใช้ cop แบบอเมริกันที่มี /ɑː/ ในระบบถอดเสียงนี้ ไม่ใช่ /ɒ/ แบบอังกฤษ; บางระบบเขียนสระนี้ /ɑ/ โดยไม่ใส่เครื่องหมายยาว'});

  add('eɪ', word('late', 'eɪ'), word('let', 'ɛ'),
    'late /eɪ/ เริ่มลิ้นส่วนหน้าระดับกลางแล้วเลื่อนสูงขึ้น ส่วน let /ɛ/ ค้างคุณภาพสระมากกว่าและเปิดปากกว้างกว่าช่วงจบของ late',
    ['ฟัง late “สาย” แล้ว let “ยอมให้”',
      'พูด late โดยเลื่อนลิ้นสูงขึ้นอย่างต่อเนื่องในพยางค์เดียว แล้วพูด let โดยไม่เติมเสียงเลื่อนท้าย',
      'สลับ late — let ให้ต้น /l/ และท้าย /t/ คงเดิม อย่าแยก late เป็นสองพยางค์'],
    {note: 'Cambridge เขียนสระของ let เป็น /e/; ที่นี่ใช้ /ɛ/ สำหรับเสียงกลุ่มเดียวกันในคำตัวอย่าง ไม่ใช่ชื่อตัวอักษร E', sources: [diphthongSource, vowelSource]});
  add('aɪ', word('bite', 'aɪ'), word('bit', 'ɪ'),
    'bite /aɪ/ เริ่มอ้าปากและวางลิ้นต่ำ แล้วเลื่อนสูงขึ้น ส่วน bit /ɪ/ เริ่มลิ้นค่อนสูงอยู่แล้วและไม่เลื่อนกว้างแบบ bite',
    ['ฟัง bite “กัด” แล้ว bit “ชิ้นเล็ก ๆ”',
      'พูด bite โดยเริ่มอ้าปากแล้วค่อยเลื่อนลิ้นสูงขึ้นในพยางค์เดียว',
      'พูด bit แบบผ่อนลิ้นค่อนสูง แล้วสลับ bite — bit โดยไม่เพิ่มสระท้าย'],
    {sources: [diphthongSource, smallISource]});
  add('oʊ', word('note', 'oʊ'), word('not', 'ɑː'),
    'note แบบอเมริกัน /oʊ/ ห่อปากและเลื่อนลิ้นสูงขึ้น ส่วน not /ɑː/ อ้าปากและไม่ห่อ จึงต่างทั้งรูปปากและการเคลื่อนของสระ',
    ['เลือกเสียงอเมริกัน แล้วฟัง note “บันทึก” กับ not “ไม่”',
      'พูด note โดยเริ่มห่อปากแล้วเลื่อนสูงขึ้น จากนั้นพูด not โดยอ้าปากไม่ห่อ',
      'สลับ note — not ให้ต้น /n/ และท้าย /t/ คงเดิม ไม่เติมพยางค์กลาง'],
    {note: 'คู่นี้ใช้ note /oʊ/ และ not /ɑ(ː)/ แบบอเมริกัน; รูปอังกฤษ /əʊ/ กับ /ɒ/ ต้องใช้เสียงตัวอย่างอีกชุด', sources: [diphthongSource, vowelSource]});
  add('aʊ', word('now', 'aʊ'), word('no', 'oʊ'),
    'now /aʊ/ เริ่มอ้าปากกว้างแล้วค่อยห่อ ส่วน no แบบอเมริกัน /oʊ/ เริ่มด้วยปากห่อกว่าและลิ้นสูงกว่า ก่อนเลื่อนต่อ',
    ['ฟัง now “ตอนนี้” แล้ว no “ไม่” แบบอเมริกัน',
      'พูด now โดยเริ่มอ้าปากแล้วห่อช้า ๆ ส่วน no เริ่มห่ออยู่แล้ว',
      'สลับ now — no เป็นพยางค์เดียว ฟังจุดเริ่มของสระ ไม่ใช่เฉพาะเสียงตอนจบ'],
    {sources: [diphthongSource, vowelSource]});
  add('ɔɪ', word('boy', 'ɔɪ'), word('buy', 'aɪ'),
    'boy /ɔɪ/ เริ่มห่อปากและวางลิ้นค่อนไปด้านหลัง ส่วน buy /aɪ/ เริ่มอ้าปากและไม่ห่อ ทั้งคู่ค่อยเลื่อนไปด้านหน้าและสูงขึ้น',
    ['ฟัง boy “เด็กผู้ชาย” แล้ว buy “ซื้อ”',
      'พูด boy โดยเริ่มปากห่อแล้วคลายเข้าหา /ɪ/ ส่วน buy เริ่มอ้าปากไม่ห่อ',
      'สลับ boy — buy ในพยางค์เดียว ฟังความต่างที่จุดเริ่มสระ'],
    {sources: [diphthongSource, vowelSource]});

  add('ə', word('about', 'ə'), word('cup', 'ʌ'),
    'ต้น about ใช้สระเบา /ə/ ลิ้นและปากผ่อนใกล้กลาง ส่วน cup /ʌ/ เป็นพยางค์เน้นและมักเปิดปากหรือลดลิ้นมากกว่า คุณภาพอาจใกล้กันได้ตามสำเนียง',
    ['ฟัง about โดยสนใจเฉพาะพยางค์แรก a- ที่เบากว่าพยางค์หลัง',
      'ฟัง cup แล้วเทียบว่าพยางค์นี้มีน้ำหนักชัดกว่า อย่าเน้น a- ต้น about ให้หนักเท่ากัน',
      'พูด about ทั้งคำ แล้ว cup โดยไม่พยายามทำให้ต่างกันด้วยการตะโกน'],
    {title: 'ฟังสระเบาใน about เทียบกับสระเต็มใน cup', minimalPair: false,
      note: 'นี่เป็นการเทียบสระเบากับสระในพยางค์เน้น ไม่ใช่คู่คำที่ต่างกันเพียงเสียงเดียว สังเกตตำแหน่งสระภายในคำเต็ม'});
  add('ɐ', word('above', 'ə'), word('cup', 'ʌ'),
    '/ɐ/ อยู่กลางปากและค่อนต่ำกว่า /ə/ ใน IPA แบบละเอียด ตัวอย่างต้น above ใช้ /ə/ เพื่อช่วยฟังแนวสระเบา ไม่ได้ยืนยันว่าเป็นเสียง /ɐ/ ตรงตัว',
    ['ฟังพยางค์แรก a- ของ above เป็นตัวอย่างสระเบาที่เกี่ยวข้อง ไม่ใช่ตัวอย่าง /ɐ/ ที่ยืนยันแล้ว',
      'ฟัง cup แล้วสังเกตสระเต็มในพยางค์เน้น เปรียบเทียบกับพยางค์แรกที่เบาของ above',
      'ถ้าคำอ่านเป้าหมายเป็น /ɐ/ ให้ใช้ตำแหน่งลิ้นกลางค่อนต่ำและฟังต้นแบบสำเนียงเดียวกันเพิ่ม ไม่บังคับให้ทุกเสียงเหมือน /ə/'],
    {title: 'สระกลางค่อนต่ำ — ฟังสระเบาที่เกี่ยวข้อง', minimalPair: false, exactTarget: false,
      note: 'ไฟล์ above อ้างอิง /ə/ ไม่ใช่ไฟล์ยืนยัน /ɐ/; แสดงเพื่อช่วยเทียบแนวเสียงเบาเท่านั้น รูปเสียงจริงเปลี่ยนตามสำเนียง',
      sources: [vowelSource, 'https://www.internationalphoneticassociation.org/content/ipa-chart-projects']});

  // UK-only descriptions must not turn an available US recording into a UK
  // example by changing a label. The player must verify its real reference.
  add('ɒ', word('not', 'ɒ'), word('note', 'əʊ'),
    'not แบบอังกฤษ /ɒ/ วางลิ้นต่ำด้านหลังและห่อปาก ส่วน note /əʊ/ เริ่มปากผ่อนค่อนไปกลางแล้วเลื่อนเข้าปากห่อ',
    ['ใช้เสียงตัวอย่างอังกฤษที่คำอ่านตรงกัน แล้วฟัง not — note',
      'พูด not โดยเริ่มลิ้นต่ำด้านหลัง ส่วน note เลื่อนจากท่าผ่อนเข้าปากห่อ',
      'คง /n/ และ /t/ ไว้ ฟังสระค้างเทียบสระเลื่อน'],
    {accent: 'en-gb', note: 'ใช้ได้เมื่อไฟล์ not มี /ɒ/ และ note มี /əʊ/ จริง เสียง not แบบอเมริกัน /ɑ(ː)/ ไม่ใช่ตัวอย่าง /ɒ/', sources: [vowelSource, diphthongSource]});
  add('əʊ', word('note', 'əʊ'), word('not', 'ɒ'),
    'note แบบอังกฤษ /əʊ/ เริ่มปากผ่อนกลาง ๆ แล้วเลื่อนเข้าปากห่อ ส่วน not /ɒ/ เริ่มสระต่ำด้านหลังและค้างคุณภาพมากกว่า',
    ['ใช้เสียงอังกฤษที่ตรวจคำอ่านไว้ แล้วฟัง note — not',
      'พูด note โดยค่อยห่อปากจากจุดเริ่มผ่อนกลาง ๆ ไม่เริ่มเหมือน /oʊ/ ทุกสำเนียง',
      'พูด not โดยวางลิ้นต่ำด้านหลัง แล้วสลับสองคำให้เป็นพยางค์เดียว'],
    {accent: 'en-gb', note: 'ต้องตรวจทั้งคู่: note /əʊ/ และ not /ɒ/ ไม่ใช้ไฟล์อเมริกันแล้วเปลี่ยนป้ายเป็นสำเนียงอังกฤษ', sources: [diphthongSource, vowelSource]});
  add('ɔː', word('thought', 'ɔː'), word('father', 'ɑː'),
    'ในสำเนียงอังกฤษที่แยกสระนี้ thought /ɔː/ ห่อปากและยกลิ้นด้านหลังสูงกว่า ส่วน father /ɑː/ อ้าปากกว่าและไม่ห่อ',
    ['ใช้เสียงอังกฤษที่ตรวจไว้ แล้วฟังสระของ thought กับ father โดยไม่พยายามเทียบพยัญชนะทั้งคำ',
      'สลับปากห่อและลิ้นด้านหลังระดับกลางของ thought กับปากอ้าและลิ้นต่ำของ father',
      'กลับไปพูดทั้งคำตามตัวอย่าง สำเนียงที่รวมสระนี้อาจฟังคล้ายกันได้'],
    {accent: 'en-gb', minimalPair: false, note: 'ไม่ใช่คู่คำที่ต่างเพียงเสียงเดียว และไม่ใช่ทุกสำเนียงจะแยกสองสระนี้; thought แบบอเมริกันบางตัวอย่างเป็น /ɑː/ จึงต้องตรวจไฟล์ก่อน'});
  add('ɜː', word('bird', 'ɜː'), word('bed', 'ɛ'),
    'bird แบบอังกฤษที่ไม่ออกเสียง r ใช้ /ɜː/ กลางปาก ส่วน bed /ɛ/ วางลิ้นค่อนไปด้านหน้า ไม่ห่อปากทั้งคู่',
    ['ใช้เสียง bird แบบอังกฤษที่ไม่มีเสียง r ต่อท้าย แล้วฟังเทียบ bed',
      'พูด bird โดยค้างลิ้นกลางปาก จากนั้นเลื่อนไปด้านหน้าเพื่อพูด bed',
      'สลับ bird — bed โดยไม่เติม /ɹ/ หากกำลังฝึกตัวอย่างอังกฤษรูปนี้'],
    {accent: 'en-gb', note: 'bird แบบอเมริกันมักมีสระ r เช่น /ɝː/ ซึ่งไม่ใช่ตัวอย่าง /ɜː/ ต้องใช้ไฟล์ตรงสำเนียงและคำอ่าน; bed อาจเขียน /e/ ในพจนานุกรม'});

  function alias(symbol, from, note) {
    PAIRS[symbol] = {...PAIRS[from], target: symbol, exactTarget: false,
      note: note + ' · ' + PAIRS[from].note};
  }
  alias('i', 'iː', 'สัญลักษณ์ /i/ ไม่ระบุความยาว; ใช้ seat /iː/ เทียบคุณภาพสระหน้าสูง ไม่อ้างว่าแทน /i/ ในทุกบริบท');
  alias('u', 'uː', 'สัญลักษณ์ /u/ ไม่ระบุความยาว; pool /uː/ เป็นตัวเทียบสระสูงห่อปาก ไม่ใช่การยืนยันความยาวของเสียงเป้าหมาย');
  alias('e', 'ɛ', 'พจนานุกรมอังกฤษบางเล่มใช้ /e/ แทนสระ bed ขณะที่ IPA แบบละเอียดแยก [e] กับ [ɛ]; ฟังคุณภาพตามคำและสำเนียง');
  alias('ɑ', 'ɑː', 'บางระบบถอดสระ cop แบบอเมริกันเป็น /ɑ/ ไม่ใส่ ː; ตัวอย่างนี้ใช้ป้าย /ɑː/ จึงไม่ยืนยันความยาวของ /ɑ/ ทุกบริบท');
  alias('ɔ', 'ɔː', 'ใช้ thought /ɔː/ แบบอังกฤษเป็นตัวเทียบสระหลังห่อปาก ไม่ถือว่าสัญลักษณ์ /ɔ/ ต้องยาวเท่ากันทุกคำ');

  function normalize(value) {
    if (typeof value !== 'string' || value.length > 64 || /[<>&\u0000-\u001f]/.test(value)) return '';
    return value.normalize('NFC').trim().replace(/^[/\[\]]+|[/\[\]]+$/g, '')
      .replace(/[ˈˌ\u0361\u035c]/g, '').replace(/:/g, 'ː').trim();
  }
  function forPhone(value) {
    const symbol = normalize(value);
    if (!Object.prototype.hasOwnProperty.call(PAIRS, symbol)) return null;
    return JSON.parse(JSON.stringify(PAIRS[symbol]));
  }
  return Object.freeze({forPhone});
});
