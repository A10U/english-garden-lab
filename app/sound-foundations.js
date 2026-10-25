/* Original Thai beginner coaching, based on articulation facts in the primary
 * educational references linked in each description. No chart, recording or
 * source prose is copied. This is a simplified teaching model, not an image of
 * a learner's mouth. Articulation, duration and voicing vary with accent and
 * surrounding sounds. Examples identify a sound in a WORD, not letter names.
 * No requests, audio playback or microphone access occur in this module.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EGLSoundFoundations = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SOURCES = {
    ipa: 'https://www.internationalphoneticassociation.org/content/ipa-chart-projects',
    consonants: 'https://ecampusontario.pressbooks.pub/essentialsoflinguistics2/chapter/3-3-describing-consonants-place-and-phonation/',
    manner: 'https://ecampusontario.pressbooks.pub/essentialsoflinguistics2/chapter/3-4-describing-consonants-manner/',
    vowels: 'https://ecampusontario.pressbooks.pub/essentialsoflinguistics2/chapter/3-5-describing-vowels/',
    diphthongs: 'https://ecampusontario.pressbooks.pub/essentialsoflinguistics/chapter/2-8-diphthongs/',
    aspiration: 'https://ecampusontario.pressbooks.pub/essentialsoflinguistics/chapter/3-5-aspirated-stops-in-english/',
    fricatives: 'https://corpus.eduhk.hk/english_pronunciation/index.php/3-2-acoustic-aspects-of-consonants/',
    f: 'https://enunciate.arts.ubc.ca/2016/04/07/31/',
    l: 'https://enunciate.arts.ubc.ca/l/',
    r: 'https://enunciate.arts.ubc.ca/%C9%B9/',
    i: 'https://enunciate.arts.ubc.ca/i/',
    smallI: 'https://enunciate.arts.ubc.ca/%C9%AA/',
    u: 'https://enunciate.arts.ubc.ca/u/',
    smallU: 'https://enunciate.arts.ubc.ca/%CA%8A/',
    ae: 'https://enunciate.arts.ubc.ca/ae/',
    affricate: 'https://enunciate.arts.ubc.ca/%CA%A7/',
    nasal: 'https://enunciate.arts.ubc.ca/author/tiffany-doe/'
  };
  const ENTRIES = Object.create(null);
  const voiced = 'คอสั่น — มีเสียงก้องจากเส้นเสียง';
  const unvoiced = 'คอไม่สั่น — ไม่มีเสียงก้องจากเส้นเสียง';
  const throatCheck = 'แตะด้านหน้าลำคอเบา ๆ เพื่อสังเกตการสั่น ไม่ต้องกดหรือเกร็งคอ';
  const oralAir = 'ลมหายใจออกทางปาก';
  const nasalAir = 'ลมออกทางจมูก ขณะที่ทางปากถูกปิดอยู่บางตำแหน่ง';
  const schemaNote = 'ภาพแสดงตำแหน่งโดยประมาณสำหรับฝึก เสียงจริงเปลี่ยนได้ตามสำเนียงและเสียงข้างเคียง';

  function picture(place, tongue, hasVoice, nasal, lips, extra) {
    return Object.assign({place, tongue, voiced: hasVoice, nasal, lips, contact: false, note: schemaNote}, extra || {});
  }
  function add(symbol, entry) {
    ENTRIES[symbol] = Object.assign({symbol, known: true, compare: null}, entry);
  }
  function pair(phone, word, note) { return {phone, word, note}; }

  // Stops have a closure and release; the burst cannot be held like /f/.
  const stops = [
    {phone: 'p', word: 'pen', other: 'b', otherWord: 'bed', place: 'ริมฝีปากบนกับล่าง',
      at: 'lips', position: 'central', lips: 'ปิดริมฝีปากทั้งสอง แล้วเปิดออก',
      tongue: 'ไม่ใช้ลิ้นปิดทางลม วางลิ้นเตรียมรับสระถัดไป',
      close: 'ปิดริมฝีปากทั้งสองให้ลมยังออกไม่ได้', release: 'เปิดริมฝีปากให้ลมออกสั้น ๆ ครั้งเดียว',
      aspiration: 'ต้นพยางค์เน้น เช่น pen มักมีลมตาม แต่หลัง /s/ เช่น spin ลมตามจะน้อยลง'},
    {phone: 'b', word: 'bed', other: 'p', otherWord: 'pen', place: 'ริมฝีปากบนกับล่าง',
      at: 'lips', position: 'central', lips: 'ปิดริมฝีปากทั้งสอง แล้วเปิดออก',
      tongue: 'ไม่ใช้ลิ้นปิดทางลม วางลิ้นเตรียมรับสระถัดไป',
      close: 'ปิดริมฝีปากทั้งสองให้ลมยังออกไม่ได้', release: 'เปิดริมฝีปากออก พร้อมเข้าเสียงก้องของคำ'},
    {phone: 't', word: 'tea', other: 'd', otherWord: 'day', place: 'ปุ่มเหงือกหลังฟันบน',
      at: 'ridge', position: 'front-high', lips: 'เปิดริมฝีปากตามสระ ไม่ใช้ปากปิดลม',
      tongue: 'ใช้ปลายลิ้นหรือส่วนหน้าของลิ้นแตะปุ่มเหงือกหลังฟันบน',
      close: 'ยกปลายลิ้นแตะปุ่มเหงือกหลังฟันบน ปิดทางลมชั่วครู่', release: 'ลดลิ้นออกจากจุดแตะ ให้ลมหลุดออกสั้น ๆ',
      aspiration: 'ต้นพยางค์เน้น เช่น tea มักมีลมตาม แต่หลัง /s/ เช่น stay ลมตามจะน้อยลง'},
    {phone: 'd', word: 'day', other: 't', otherWord: 'tea', place: 'ปุ่มเหงือกหลังฟันบน',
      at: 'ridge', position: 'front-high', lips: 'เปิดริมฝีปากตามสระ ไม่ใช้ปากปิดลม',
      tongue: 'ใช้ปลายลิ้นหรือส่วนหน้าของลิ้นแตะปุ่มเหงือกหลังฟันบน',
      close: 'ยกปลายลิ้นแตะปุ่มเหงือกหลังฟันบน ปิดทางลมชั่วครู่', release: 'ลดลิ้นออกจากจุดแตะ พร้อมเข้าเสียงก้องของคำ'},
    {phone: 'k', word: 'key', other: 'ɡ', otherWord: 'go', place: 'ลิ้นด้านหลังกับเพดานอ่อน',
      at: 'velum', position: 'back-high', lips: 'เปิดริมฝีปากตามสระ ไม่ใช้ฟันกับปากปิดลม',
      tongue: 'ยกส่วนหลังของลิ้นแตะเพดานอ่อนด้านหลังปาก',
      close: 'ยกส่วนหลังของลิ้นแตะเพดานอ่อน ปิดทางลมชั่วครู่', release: 'ลดส่วนหลังของลิ้นให้ลมออกสั้น ๆ',
      aspiration: 'ต้นพยางค์เน้น เช่น key มักมีลมตาม แต่หลัง /s/ เช่น ski ลมตามจะน้อยลง'},
    {phone: 'ɡ', word: 'go', other: 'k', otherWord: 'key', place: 'ลิ้นด้านหลังกับเพดานอ่อน',
      at: 'velum', position: 'back-high', lips: 'เปิดริมฝีปากตามสระ ไม่ใช้ฟันกับปากปิดลม',
      tongue: 'ยกส่วนหลังของลิ้นแตะเพดานอ่อนด้านหลังปาก',
      close: 'ยกส่วนหลังของลิ้นแตะเพดานอ่อน ปิดทางลมชั่วครู่', release: 'ลดส่วนหลังของลิ้น พร้อมเข้าเสียงก้องของคำ'}
  ];
  for (const s of stops) {
    const hasVoice = ['b', 'd', 'ɡ'].includes(s.phone);
    add(s.phone, {
      category: 'พยัญชนะ — เสียงหยุด', place: s.place,
      manner: 'ปิดทางลมทั้งหมดชั่วครู่ แล้วปล่อยออก ไม่สามารถค้างช่วงปล่อยเสียงได้',
      voice: hasVoice ? voiced + ' โดยจังหวะเริ่มสั่นเปลี่ยนได้ตามตำแหน่งในคำ' : unvoiced,
      airflow: oralAir + ' โดยถูกกั้นก่อนปล่อย', lips: s.lips, tongue: s.tongue, canSustain: false,
      steps: [s.close, s.release, 'ลองเสียงต้นของ ' + s.word + ' สั้น ๆ ไม่เติมสระตามพยัญชนะ',
        s.aspiration || 'ฟังสลับกับ /' + s.other + '/ ใน ' + s.otherWord + '; ไม่ต้องออกแรงพ่นลมเพิ่ม'],
      commonMistake: 'อย่าพยายามลากเสียงระเบิดยาวหรือเติมสระท้าย คำลงท้ายเสียงหยุดอาจไม่มีเสียงปล่อยชัด จึงควรฟังทั้งคำ',
      compare: pair(s.other, s.otherWord, 'ตำแหน่งปิดลมคล้ายกัน แต่จังหวะเสียงก้องและลมตามต่างกัน'),
      visual: picture(s.at, s.position, hasVoice, false, 'release',
        {manner: 'stop', contact: s.at !== 'lips'}),
      sources: [SOURCES.ipa, SOURCES.consonants, SOURCES.aspiration]
    });
  }

  const fricatives = [
    {phone: 'f', word: 'fan', other: 'v', otherWord: 'van', at: 'teeth', position: 'central',
      place: 'ฟันหน้าบนกับริมฝีปากล่าง', lips: 'ให้ฟันบนแตะริมฝีปากล่างเบา ๆ ไม่กัดแน่น',
      tongue: 'ลิ้นไม่ใช่จุดกั้นลมหลัก วางสบาย ๆ ภายในปาก',
      setup: 'วางฟันหน้าบนแตะริมฝีปากล่างเบา ๆ',
      mistake: 'อย่าเม้มริมฝีปากทั้งสองเหมือน /p/ และอย่าให้คอสั่นจนเป็น /v/'},
    {phone: 'v', word: 'van', other: 'f', otherWord: 'fan', at: 'teeth', position: 'central',
      place: 'ฟันหน้าบนกับริมฝีปากล่าง', lips: 'ให้ฟันบนแตะริมฝีปากล่างเบา ๆ ไม่เม้มริมฝีปากทั้งสอง',
      tongue: 'ลิ้นไม่ใช่จุดกั้นลมหลัก วางสบาย ๆ ภายในปาก',
      setup: 'วางฟันบนกับริมฝีปากล่างเหมือนทำ /f/',
      mistake: 'ถ้ามีแต่ลมไม่มีเสียงก้องจะใกล้ /f/; อย่าห่อปากเป็น /w/'},
    {phone: 'θ', word: 'thin', other: 'ð', otherWord: 'this', at: 'teeth', position: 'front-high',
      place: 'ปลายลิ้นกับฟันหน้าบน หรือระหว่างฟันหน้า', lips: 'เปิดปากเล็กน้อย ให้ริมฝีปากไม่ขวางปลายลิ้น',
      tongue: 'วางปลายลิ้นแตะฟันหน้าเบา ๆ หรือยื่นระหว่างฟันนิดเดียว เหลือช่องให้ลมผ่าน',
      setup: 'วางปลายลิ้นชิดฟันหน้าเบา ๆ ไม่กัดลิ้นและไม่ปิดทางลมสนิท',
      mistake: 'อย่าปิดลมเป็น /t/ หรือถอยลิ้นไปทำ /s/; ไม่จำเป็นต้องยื่นลิ้นออกมาไกล'},
    {phone: 'ð', word: 'this', other: 'θ', otherWord: 'thin', at: 'teeth', position: 'front-high',
      place: 'ปลายลิ้นกับฟันหน้าบน หรือระหว่างฟันหน้า', lips: 'เปิดปากเล็กน้อย ให้ริมฝีปากไม่ขวางปลายลิ้น',
      tongue: 'วางปลายลิ้นแตะฟันหน้าเบา ๆ หรือยื่นระหว่างฟันนิดเดียว เหลือช่องให้ลมผ่าน',
      setup: 'วางลิ้นชิดฟันเหมือน /θ/ แล้วเพิ่มเสียงก้อง',
      mistake: 'อย่าปิดทางลมเป็น /d/ และอย่าเปลี่ยนเป็น /z/ ที่ลิ้นอยู่หลังฟัน'},
    {phone: 's', word: 'sun', other: 'z', otherWord: 'zoo', at: 'ridge', position: 'front-high',
      place: 'ลิ้นส่วนหน้าใกล้ปุ่มเหงือกหลังฟันบน', lips: 'เปิดปากแคบ ๆ ไม่ต้องห่อริมฝีปาก',
      tongue: 'ยกลิ้นส่วนหน้าใกล้ปุ่มเหงือก เหลือช่องลมแคบตรงกลาง ไม่ปิดสนิท',
      setup: 'ให้ฟันอยู่ใกล้กันและยกลิ้นส่วนหน้าใกล้ปุ่มเหงือก',
      mistake: 'อย่าเอาลิ้นออกไประหว่างฟันเหมือน /θ/ หรือถอยลิ้นเป็น /ʃ/'},
    {phone: 'z', word: 'zoo', other: 's', otherWord: 'sun', at: 'ridge', position: 'front-high',
      place: 'ลิ้นส่วนหน้าใกล้ปุ่มเหงือกหลังฟันบน', lips: 'เปิดปากแคบ ๆ ไม่ต้องห่อริมฝีปาก',
      tongue: 'ยกลิ้นส่วนหน้าใกล้ปุ่มเหงือก เหลือช่องลมแคบตรงกลาง ไม่ปิดสนิท',
      setup: 'วางลิ้นเหมือน /s/ แล้วเพิ่มเสียงก้อง',
      mistake: 'ถ้าคอไม่สั่นเลยจะใกล้ /s/; อย่าเติมสระเพื่อช่วยให้ก้อง'},
    {phone: 'ʃ', word: 'ship', other: 'ʒ', otherWord: 'vision', at: 'ridge', position: 'front-high',
      place: 'ลิ้นส่วนหน้าใกล้บริเวณถัดหลังปุ่มเหงือก', lips: 'ห่อหรือยื่นริมฝีปากออกเล็กน้อย',
      tongue: 'ยกลิ้นส่วนหน้าใกล้บริเวณหลังปุ่มเหงือก ถอยจุดแคบไปจาก /s/ เล็กน้อย',
      setup: 'ห่อปากเล็กน้อย แล้วยกลิ้นใกล้บริเวณถัดหลังปุ่มเหงือก',
      mistake: 'อย่าปิดลมก่อนจนกลายเป็น /tʃ/ และอย่าวางลิ้นมาหน้าเกินจนเป็น /s/'},
    {phone: 'ʒ', word: 'vision', other: 'ʃ', otherWord: 'ship', at: 'ridge', position: 'front-high',
      place: 'ลิ้นส่วนหน้าใกล้บริเวณถัดหลังปุ่มเหงือก', lips: 'ห่อหรือยื่นริมฝีปากออกเล็กน้อย',
      tongue: 'ยกลิ้นส่วนหน้าใกล้บริเวณหลังปุ่มเหงือก เหลือช่องให้ลมผ่าน',
      setup: 'วางปากกับลิ้นเหมือน /ʃ/ แล้วเพิ่มเสียงก้อง',
      mistake: 'อย่าปิดลมก่อนจนกลายเป็น /dʒ/; เสียงเป้าหมายอยู่กลางคำ vision'}
  ];
  for (const f of fricatives) {
    const hasVoice = ['v', 'ð', 'z', 'ʒ'].includes(f.phone);
    add(f.phone, {
      category: 'พยัญชนะ — เสียงลมเสียดสี', place: f.place,
      manner: 'ปล่อยลมผ่านช่องแคบต่อเนื่องจนเกิดเสียงเสียดสี ไม่ปิดทางลมทั้งหมด',
      voice: hasVoice ? voiced : unvoiced, airflow: oralAir + ' ผ่านช่องแคบต่อเนื่อง',
      lips: f.lips, tongue: f.tongue, canSustain: true,
      steps: [f.setup, 'เป่าลมเบา ๆ ผ่านช่องแคบให้ต่อเนื่อง ไม่ออกแรงบีบคอ',
        hasVoice ? 'เพิ่มเสียงก้องให้รู้สึกคอสั่นเบา ๆ; ' + throatCheck : 'ให้เป็นเสียงลม คอไม่สั่น; ' + throatCheck,
        'ลองค้าง /' + f.phone + '/ สั้น ๆ แล้วฟังเสียงนี้ใน ' + f.word],
      commonMistake: f.mistake,
      compare: pair(f.other, f.otherWord, 'ตำแหน่งปากและลิ้นใกล้กัน ให้สังเกตว่าคอสั่นหรือไม่ขณะมีลมผ่าน'),
      visual: picture(f.at, f.position, hasVoice, false, ['ʃ', 'ʒ'].includes(f.phone) ? 'rounded' : 'neutral', {manner: 'fricative'}),
      sources: [f.phone === 'f' || f.phone === 'v' ? SOURCES.f : SOURCES.fricatives, SOURCES.ipa]
    });
  }

  for (const a of [
    {phone: 'tʃ', word: 'chair', other: 'dʒ', otherWord: 'job', hasVoice: false},
    {phone: 'dʒ', word: 'job', other: 'tʃ', otherWord: 'chair', hasVoice: true}
  ]) {
    add(a.phone, {
      category: 'พยัญชนะ — เสียงหยุดต่อด้วยลมเสียดสี', place: 'ลิ้นส่วนหน้ากับบริเวณถัดหลังปุ่มเหงือก',
      manner: 'ปิดทางลมก่อน แล้วค่อยเปิดเป็นช่องแคบมีลมเสียดสี เป็นพยัญชนะหนึ่งหน่วย',
      voice: a.hasVoice ? voiced : unvoiced,
      airflow: oralAir + ' จากช่วงกั้นลมเข้าสู่ช่วงเสียดสี', lips: 'ห่อปากเล็กน้อย ไม่ปิดริมฝีปาก',
      tongue: 'ให้ลิ้นส่วนหน้าปิดบริเวณหลังปุ่มเหงือก แล้วเปิดออกเล็กน้อยให้ลมเสียดสี', canSustain: false,
      steps: ['ยกลิ้นส่วนหน้าไปปิดทางลมแถวหลังปุ่มเหงือก',
        'ค่อยปล่อยจากจุดปิดให้เป็นลมเสียดสีต่อทันที ไม่แทรกสระ',
        a.hasVoice ? 'เพิ่มเสียงก้องให้คอสั่นเหมือนเสียงต้น job' : 'ใช้ลมโดยคอไม่สั่นเหมือนเสียงต้น chair',
        'ฝึกสั้น ๆ หนึ่งจังหวะ ค้างได้เฉพาะช่วงลมเสียดสี ไม่ใช่ทั้ง /' + a.phone + '/'],
      commonMistake: 'ถ้าเริ่มด้วยลมเสียดสีทันทีจะใกล้ /' + (a.hasVoice ? 'ʒ' : 'ʃ') + '/; อย่าแยกเป็นสองพยางค์หรือเติมสระคั่น',
      compare: pair(a.other, a.otherWord, 'วิธีปิดแล้วปล่อยใกล้กัน แต่ต่างกันที่เสียงก้อง'),
      visual: picture('ridge', 'front-high', a.hasVoice, false, 'rounded',
        {manner: 'affricate', contact: true, contactPhase: 'closure'}),
      sources: [SOURCES.affricate, SOURCES.fricatives]
    });
  }

  for (const n of [
    {phone: 'm', word: 'moon', at: 'lips', position: 'central', place: 'ริมฝีปากทั้งสอง',
      lips: 'ปิดริมฝีปากทั้งสองเบา ๆ', tongue: 'ลิ้นไม่ต้องปิดทางปาก วางตามเสียงข้างเคียง',
      setup: 'ปิดริมฝีปากทั้งสองเบา ๆ เหมือนเริ่มคำ moon',
      mistake: 'อย่าเปิดปากปล่อยลมออกเป็น /b/ และอย่าเติมสระหลังเสียง /m/', other: 'n', otherWord: 'night'},
    {phone: 'n', word: 'night', at: 'ridge', position: 'front-high', place: 'ปลายลิ้นกับปุ่มเหงือกหลังฟันบน',
      lips: 'เปิดริมฝีปากได้ ไม่ต้องเม้ม', tongue: 'แตะปลายลิ้นหรือส่วนหน้าของลิ้นที่ปุ่มเหงือกหลังฟันบน',
      setup: 'เปิดปากเล็กน้อย แล้วยกปลายลิ้นแตะปุ่มเหงือกหลังฟันบน',
      mistake: 'อย่าให้ลมหลุดข้างลิ้นเป็น /l/ และอย่าปล่อยเป็น /d/', other: 'ŋ', otherWord: 'sing'},
    {phone: 'ŋ', word: 'sing', at: 'velum', position: 'back-high', place: 'ลิ้นด้านหลังกับเพดานอ่อน',
      lips: 'เปิดปากได้ ไม่จำเป็นต้องปิดริมฝีปาก', tongue: 'ยกส่วนหลังของลิ้นแตะเพดานอ่อน ปลายลิ้นไม่ต้องแตะปุ่มเหงือก',
      setup: 'ยกส่วนหลังของลิ้นแตะเพดานอ่อนเหมือนจุดปิดของ /ɡ/',
      mistake: 'ใน sing เสียงท้ายคือ /ŋ/ ไม่ต้องปล่อยเป็น /ɡ/ เพิ่ม; คำอื่นอย่าง finger อาจมี /ɡ/ จึงต้องฟังทั้งคำ', other: 'n', otherWord: 'sin'}
  ]) {
    add(n.phone, {
      category: 'พยัญชนะ — เสียงทางจมูก', place: n.place,
      manner: 'ปิดทางออกในปาก แต่ลดเพดานอ่อนเปิดทางให้เสียงออกทางจมูก',
      voice: voiced, airflow: nasalAir, lips: n.lips, tongue: n.tongue, canSustain: true,
      steps: [n.setup, 'ทำเสียงก้องเบา ๆ โดยยังคงจุดปิดในปากไว้ ลมจะออกทางจมูก',
        'ลองค้างเสียงสบาย ๆ และสังเกตเสียงก้อง; ' + throatCheck,
        'ฟัง /' + n.phone + '/ ใน ' + n.word + ' แล้วลองเชื่อมกับสระโดยไม่เติมพยัญชนะเพิ่ม'],
      commonMistake: n.mistake,
      compare: pair(n.other, n.otherWord, 'เป็นเสียงทางจมูกเหมือนกัน แต่ใช้จุดปิดในปากต่างกัน'),
      visual: picture(n.at, n.position, true, true, n.phone === 'm' ? 'closed' : 'neutral',
        {manner: 'nasal', contact: n.at !== 'lips'}),
      sources: [SOURCES.nasal, SOURCES.manner, SOURCES.ipa]
    });
  }

  add('l', {
    category: 'พยัญชนะ — เสียงไหลข้างลิ้น', place: 'ปลายลิ้นกับปุ่มเหงือกหลังฟันบน',
    manner: 'ปิดทางลมตรงกลางด้วยลิ้น แล้วให้ลมไหลผ่านข้างลิ้น', voice: voiced,
    airflow: oralAir + ' ผ่านข้างลิ้นข้างหนึ่งหรือทั้งสองข้าง', lips: 'เปิดปากเล็กน้อย ไม่ต้องห่อปาก',
    tongue: 'แตะปลายลิ้นที่ปุ่มเหงือกหลังฟันบน แต่ปล่อยข้างลิ้นให้ลมผ่าน', canSustain: true,
    steps: ['หาปุ่มเหงือกนูนด้านหลังฟันหน้าบน แล้วแตะปลายลิ้นไว้เบา ๆ',
      'อย่าอุดปากทั้งด้านข้าง ให้ลมออกข้างลิ้นขณะทำเสียงก้อง',
      'ค้าง /l/ สบาย ๆ โดยปลายลิ้นยังแตะอยู่; ' + throatCheck,
      'คลายลิ้นเชื่อมเข้าสระของ leaf ไม่เติมสระก่อนเริ่ม /l/'],
    commonMistake: 'อย่ารัวหรือม้วนลิ้นแบบเสียง r; เสียง l ท้ายคำอาจยกลิ้นด้านหลังเพิ่มและฟังต่างจากต้น leaf',
    compare: pair('ɹ', 'red', '/l/ ให้ปลายลิ้นแตะ แต่ /ɹ/ แบบ red ไม่ให้ปลายลิ้นแตะเพดาน'),
    visual: picture('ridge', 'front-high', true, false, 'neutral', {manner: 'lateral', lateral: true, contact: true}),
    sources: [SOURCES.l, SOURCES.r]
  });
  add('ɹ', {
    category: 'พยัญชนะ — เสียง r แบบ red', place: 'ลิ้นเข้าใกล้บริเวณหลังปุ่มเหงือกถึงเพดานแข็ง',
    manner: 'เข้าใกล้แต่ไม่ปิดทางลม และไม่ให้เกิดเสียงลิ้นรัว', voice: voiced,
    airflow: oralAir + ' ผ่านช่องกลางปากโดยไม่มีเสียงเสียดสีแรง', lips: 'อาจห่อปากเล็กน้อย ไม่ใช้ฟันแตะริมฝีปาก',
    tongue: 'ยกลิ้นใกล้เพดานโดยปลายลิ้นไม่แตะ อาจรวบส่วนลิ้นขึ้นหรือยกปลายเล็กน้อยตามผู้พูด', canSustain: true,
    steps: ['เปิดปากเล็กน้อยแล้วยกลิ้นเข้าใกล้เพดานด้านหลังปุ่มเหงือก',
      'เว้นช่องไว้ ไม่ให้ปลายลิ้นแตะเพดานหรือรัว',
      'ทำเสียงก้องสบาย ๆ แล้วฟังเสียงต้น red ไม่ต้องฝืนม้วนลิ้น',
      'สลับ leaf กับ red เพื่อสังเกตว่า /l/ แตะลิ้น แต่ /ɹ/ ไม่แตะ'],
    commonMistake: 'อย่ารัวลิ้นเป็น /r/ ตาม IPA แบบละเอียด และอย่าบังคับว่าทุกคนต้องม้วนลิ้นเหมือนกัน',
    compare: pair('l', 'leaf', 'เปลี่ยนจากปลายลิ้นไม่แตะของ /ɹ/ ไปเป็นลิ้นแตะและลมไหลข้างของ /l/'),
    visual: picture('palate', 'front-mid', true, false, 'rounded', {manner: 'approximant', contact: false}),
    sources: [SOURCES.r, SOURCES.l]
  });
  add('h', {
    category: 'พยัญชนะ — เสียงลมหายใจ', place: 'ทางลมบริเวณเส้นเสียงในลำคอ',
    manner: 'ผ่อนลมผ่านทางเสียง โดยไม่มีจุดปิดด้วยลิ้นหรือริมฝีปาก', voice: unvoiced,
    airflow: oralAir + ' คล้ายลมหายใจเบา ๆ', lips: 'เตรียมรูปปากของสระที่จะตามมา',
    tongue: 'เตรียมตำแหน่งสระถัดไป ไม่ใช้ลิ้นขูดเพดานเพื่อทำเสียง', canSustain: true,
    steps: ['เตรียมรูปปากเหมือนจะพูดสระของ hat', 'ผ่อนลมหายใจออกเบา ๆ โดยไม่บีบหรือขูดลำคอ',
      'ต่อจากลมเข้าสระทันที แล้วลองพูด hat ทั้งคำ'],
    commonMistake: 'อย่าเกร็งคอเพื่อทำเสียงเสียดสีแรง รูปปากและเสียงลม /h/ เปลี่ยนตามสระที่อยู่ข้าง ๆ',
    compare: pair('f', 'fan', '/h/ ไม่มีฟันแตะริมฝีปาก ส่วน /f/ ทำช่องลมที่ฟันบนกับริมฝีปากล่าง'),
    visual: picture('throat', 'central', false, false, 'neutral', {manner: 'fricative'}),
    sources: [SOURCES.ipa, SOURCES.fricatives]
  });
  add('w', {
    category: 'พยัญชนะ — เสียงเลื่อนจากปากห่อ', place: 'ริมฝีปากและลิ้นด้านหลังใกล้เพดานอ่อน',
    manner: 'ห่อปากและยกลิ้นด้านหลัง แล้วเลื่อนเข้าสระโดยไม่ปิดลม', voice: voiced,
    airflow: oralAir + ' ผ่านช่องที่ยังเปิด ไม่มีเสียงเสียดสีแรง', lips: 'ห่อริมฝีปากแล้วคลายเข้าสระ ฟันไม่แตะริมฝีปาก',
    tongue: 'ยกส่วนหลังของลิ้นเข้าใกล้เพดานอ่อน ไม่ให้แตะปิด', canSustain: true,
    steps: ['ห่อปากเล็กน้อยพร้อมยกส่วนหลังของลิ้น', 'ทำเสียงก้องเบา ๆ โดยไม่ให้ฟันแตะริมฝีปาก',
      'คลายปากเข้าหาสระทันที เช่นเสียงต้น water ไม่แยกเป็นอีกพยางค์'],
    commonMistake: 'ถ้าฟันบนแตะริมฝีปากล่างจะใกล้ /v/; ค้างท่าได้ตอนฝึก แต่ในคำ /w/ เลื่อนเข้าสระอย่างรวดเร็ว',
    compare: pair('v', 'van', '/w/ ห่อปากโดยฟันไม่แตะ ส่วน /v/ ฟันบนแตะริมฝีปากล่างและมีลมเสียดสี'),
    visual: picture('velum', 'back-high', true, false, 'rounded', {manner: 'approximant', contact: false}),
    sources: [SOURCES.consonants, SOURCES.ipa]
  });
  add('j', {
    category: 'พยัญชนะ — เสียงเลื่อนของ yes', place: 'ลิ้นส่วนหน้าใกล้เพดานแข็ง',
    manner: 'ยกลิ้นเข้าใกล้เพดานแต่ไม่แตะ แล้วเลื่อนเข้าสระถัดไป', voice: voiced,
    airflow: oralAir + ' ผ่านช่องที่ยังเปิด ไม่มีเสียงเสียดสีแรง', lips: 'ไม่ห่อปากเป็นหลัก แล้วเปลี่ยนตามสระถัดไป',
    tongue: 'ยกลิ้นส่วนหน้าให้สูงใกล้เพดานแข็ง ไม่แตะปิดทางลม', canSustain: true,
    steps: ['ยกลิ้นส่วนหน้าสูงคล้ายเตรียมสระ /i/ แต่ไม่ให้แตะเพดาน',
      'ทำเสียงก้องแล้วเลื่อนเข้าสระของ yes ทันที', 'พูด yes เป็นพยางค์เดียว ไม่เติมสระก่อนเสียงเป้าหมาย'],
    commonMistake: 'สัญลักษณ์ /j/ คือเสียงต้น yes ไม่ใช่ชื่อตัวอักษร J หรือเสียง /dʒ/ ของ job',
    compare: pair('dʒ', 'job', '/j/ ไม่ปิดลมและไม่มีช่วงเสียดสีแบบ /dʒ/'),
    visual: picture('palate', 'front-high', true, false, 'neutral', {manner: 'approximant', contact: false}),
    sources: [SOURCES.consonants, SOURCES.ipa]
  });

  // The visual positions are broad regions. Near-high /ɪ, ʊ/ deliberately use
  // a different region from /i, u/ so the simplified illustration does not teach
  // that these contrasts are only changes in duration.
  const vowels = [
    {phone: 'iː', word: 'green', pos: 'front-high', mouth: 'เปิดปากแคบ ริมฝีปากกางเล็กน้อย ไม่ห่อ',
      tongue: 'ยกลิ้นส่วนหน้าให้สูงใกล้เพดาน โดยไม่แตะปิดทางลม',
      setup: 'ยกลิ้นส่วนหน้าให้สูงและกางปากเล็กน้อย',
      mistake: 'ความต่างจาก /ɪ/ ไม่ใช่แค่ความยาว ต้องฟังคุณภาพสระและตำแหน่งลิ้นด้วย',
      other: 'ɪ', otherWord: 'sit', note: '/ɪ/ ผ่อนลิ้นให้ต่ำและเข้ากลางกว่า; ระยะเสียงจริงขึ้นกับคำด้วย', source: SOURCES.i},
    {phone: 'i', word: 'happy', pos: 'front-high', mouth: 'เปิดปากแคบและไม่ห่อริมฝีปาก',
      tongue: 'ยกลิ้นส่วนหน้าให้สูงโดยไม่แตะเพดาน', setup: 'ยกลิ้นส่วนหน้าและเปิดปากแคบ ไม่ห่อปาก',
      mistake: 'สัญลักษณ์ /i/ ที่ไม่มี ː ไม่ได้สั่งให้ลากยาว ฟังท้าย happy ตามสำเนียงเป้าหมาย',
      other: 'ɪ', otherWord: 'sit', note: 'ต่างกันที่คุณภาพและตำแหน่งลิ้น ไม่ใช่การอ่านชื่ออักษร i', source: SOURCES.i},
    {phone: 'ɪ', word: 'sit', pos: 'front-mid', mouth: 'ไม่ห่อปาก เปิดมากกว่า /iː/ เล็กน้อย',
      tongue: 'ลิ้นค่อนหน้าและค่อนสูง แต่ต่ำและเข้ากลางกว่า /iː/', setup: 'เริ่มจากท่าสระ /iː/ แล้วผ่อนลิ้นลงและเข้ากลางเล็กน้อย',
      mistake: 'อย่าเพียงตัด /iː/ ให้สั้นลง ลองฟัง sit กับ seat เพื่อแยกคุณภาพสระ',
      other: 'iː', otherWord: 'seat', note: '/iː/ ยกลิ้นส่วนหน้าสูงกว่าและชัดกว่า; ไม่ใช้ความยาวอย่างเดียว', source: SOURCES.smallI},
    {phone: 'ɛ', word: 'bed', pos: 'front-mid', mouth: 'เปิดปากปานกลาง ไม่ห่อริมฝีปาก',
      tongue: 'ลิ้นส่วนหน้าอยู่ระดับกลางค่อนต่ำ ต่ำกว่า /ɪ/', setup: 'เปิดปากปานกลางแล้วลดลิ้นส่วนหน้าจากท่า /ɪ/',
      mistake: 'อย่ายกลิ้นสูงจนเป็น /ɪ/ หรืออ้ากว้างเกินจนใกล้ /æ/',
      other: 'æ', otherWord: 'bad', note: '/æ/ อ้าปากและลดลิ้นส่วนหน้าลงกว่า /ɛ/'},
    {phone: 'e', word: 'bed', pos: 'front-mid', mouth: 'เปิดปากปานกลาง ไม่ห่อริมฝีปาก',
      tongue: 'ลิ้นอยู่ด้านหน้าระดับกลาง; ในคำอ่านอังกฤษ /e/ มักเป็นสัญลักษณ์แทนสระของ bed',
      setup: 'ฟังคำ bed ตามสำเนียงที่เลือก แล้วเปิดปากปานกลาง ลิ้นอยู่ด้านหน้า',
      mistake: 'ใน IPA แบบละเอียด [e] สูงกว่า [ɛ] แต่พจนานุกรมอังกฤษหลายเล่มใช้ /e/ แทนสระ bed อย่าเดาจากตัวเขียนอย่างเดียว',
      other: 'ɛ', otherWord: 'bed', note: 'สองรูปนี้อาจใช้แทนกลุ่มสระเดียวกันในพจนานุกรมต่างเล่ม ไม่จำเป็นต้องฝืนทำให้ต่างเสมอ'},
    {phone: 'æ', word: 'cat', pos: 'front-low', mouth: 'อ้าปากกว้าง ไม่ห่อริมฝีปาก',
      tongue: 'ลดลิ้นส่วนหน้าลงต่ำกว่าสระของ bed', setup: 'เริ่มจาก bed แล้วอ้าปากและลดลิ้นส่วนหน้าลง',
      mistake: 'อย่าเปลี่ยนเป็นสระหลัง /ɑ/; รูปเสียง cat เปลี่ยนได้ตามสำเนียงและเสียงข้างเคียง',
      other: 'ɛ', otherWord: 'bed', note: '/ɛ/ เปิดปากน้อยกว่าและลิ้นสูงกว่า', source: SOURCES.ae},
    {phone: 'ɑː', word: 'father', pos: 'back-low', mouth: 'อ้าปากกว้าง ไม่ห่อริมฝีปาก',
      tongue: 'ลิ้นต่ำค่อนไปด้านหลัง ไม่ยกขึ้นแตะเพดาน', setup: 'อ้าปากสบาย ๆ แล้ววางลิ้นต่ำค่อนไปด้านหลัง',
      mistake: 'อย่าห่อปากจนเป็น /ɔː/; ː ระบุความยาวในระบบถอดเสียง แต่ไม่ต้องฝืนลากทุกคำให้ยาวเท่ากัน',
      other: 'ɔː', otherWord: 'thought', note: '/ɔː/ ยกลิ้นด้านหลังสูงขึ้นและห่อปาก ในสำเนียงที่แยกสองสระนี้'},
    {phone: 'ɑ', word: 'father', pos: 'back-low', mouth: 'อ้าปากกว้าง ไม่ห่อริมฝีปาก',
      tongue: 'ลิ้นต่ำค่อนไปด้านหลัง ไม่แตะเพดาน', setup: 'อ้าปากและวางลิ้นต่ำค่อนไปด้านหลัง',
      mistake: 'ไม่มี ː ไม่ได้หมายความว่าต้องตัดสั้นเสมอ ระยะเสียงเปลี่ยนตามคำ สำเนียง และเสียงข้างเคียง',
      other: 'æ', otherWord: 'cat', note: '/æ/ ใช้ลิ้นค่อนไปด้านหน้า ต่างจาก /ɑ/ ที่ค่อนไปด้านหลัง'},
    {phone: 'ɔː', word: 'thought', pos: 'back-mid', rounded: true, mouth: 'ห่อริมฝีปากและเปิดปากปานกลาง',
      tongue: 'ลิ้นอยู่ด้านหลัง ระดับกลางค่อนต่ำ สูงกว่า /ɑː/', setup: 'เริ่มจากอ้าปาก แล้วห่อปากพร้อมยกลิ้นด้านหลังขึ้นเล็กน้อย',
      mistake: 'thought กับ father อาจใช้สระใกล้กันในบางสำเนียง ให้ยึดเสียงตัวอย่างที่เลือก ไม่บังคับทุกสำเนียงให้แยก',
      other: 'ɑː', otherWord: 'father', note: 'ในสำเนียงที่แยกกัน /ɑː/ ไม่ห่อปากและลิ้นต่ำกว่า'},
    {phone: 'ɔ', word: 'thought', pos: 'back-mid', rounded: true, mouth: 'ห่อริมฝีปาก เปิดปากปานกลาง',
      tongue: 'ลิ้นอยู่ด้านหลัง ระดับกลางค่อนต่ำ', setup: 'ห่อปากและวางลิ้นด้านหลังระดับกลางค่อนต่ำ',
      mistake: 'ไม่จำเป็นต้องเติมเสียงเลื่อน /ʊ/ ท้ายสระนี้ และบางสำเนียงไม่แยกสระ thought กับ father',
      other: 'ɑ', otherWord: 'father', note: 'เทียบการห่อปากและความสูงของลิ้นในสำเนียงที่แยกสระนี้'},
    {phone: 'ɒ', word: 'hot', pos: 'back-low', rounded: true, mouth: 'อ้าปากและห่อริมฝีปาก',
      tongue: 'ลิ้นต่ำค่อนไปด้านหลัง', setup: 'อ้าปากวางลิ้นต่ำด้านหลัง แล้วห่อปากเล็กน้อย',
      mistake: 'เป็นตัวอย่าง hot แบบอังกฤษหลายสำเนียง; hot แบบอเมริกันอาจใช้ /ɑ/ ที่ไม่ห่อปาก',
      other: 'ɑ', otherWord: 'hot', note: 'เทียบ hot ในสำเนียงอังกฤษกับอเมริกัน รูปปากอาจต่างกัน'},
    {phone: 'uː', word: 'food', pos: 'back-high', rounded: true, mouth: 'ห่อริมฝีปากและเปิดช่องปากแคบ',
      tongue: 'ยกลิ้นสูงค่อนไปด้านหลังหรือตรงกลางตามสำเนียง ไม่แตะเพดาน', setup: 'ห่อปากแล้วยกลิ้นให้สูง ฟังสระใน food',
      mistake: 'อย่าทำ /ʊ/ ของ book ให้ยาวอย่างเดียว /uː/ ต่างที่คุณภาพสระด้วย และตำแหน่งลิ้นอาจเลื่อนมาด้านหน้าตามสำเนียง',
      other: 'ʊ', otherWord: 'book', note: '/ʊ/ ลิ้นผ่อนและต่ำกว่า ความต่างไม่ใช่แค่ความยาว', source: SOURCES.u},
    {phone: 'u', word: 'food', pos: 'back-high', rounded: true, mouth: 'ห่อริมฝีปาก เปิดช่องปากแคบ',
      tongue: 'ลิ้นสูงค่อนไปด้านหลังหรือตรงกลางตามสำเนียง', setup: 'ห่อปากแล้วยกลิ้นสูงโดยไม่ปิดทางลม',
      mistake: 'สัญลักษณ์ /u/ ไม่ระบุให้ลากยาว รูปเสียงจริงใน food เปลี่ยนตามสำเนียง',
      other: 'ʊ', otherWord: 'book', note: '/ʊ/ ผ่อนลิ้นและเปิดปากมากกว่าเล็กน้อย', source: SOURCES.u},
    {phone: 'ʊ', word: 'book', pos: 'back-mid', rounded: true, mouth: 'ห่อปากเล็กน้อย เปิดมากกว่า /uː/ เล็กน้อย',
      tongue: 'ลิ้นค่อนสูงและค่อนไปด้านหลัง แต่ต่ำและผ่อนกว่า /uː/', setup: 'เริ่มจากท่า /uː/ แล้วผ่อนลิ้นลงและห่อปากน้อยลงเล็กน้อย',
      mistake: 'อย่าเพียงตัด /uː/ ให้สั้น ลอง book กับ food เพื่อแยกคุณภาพของสระ',
      other: 'uː', otherWord: 'food', note: '/uː/ ลิ้นสูงกว่าและคุณภาพต่างกัน ระยะเสียงไม่ใช่ตัวแยกอย่างเดียว', source: SOURCES.smallU},
    {phone: 'ʌ', word: 'cup', pos: 'central', mouth: 'เปิดปากปานกลางอย่างผ่อนคลาย ไม่ห่อปาก',
      tongue: 'ลิ้นค่อนกลางและค่อนต่ำในภาษาอังกฤษหลายสำเนียง ตำแหน่งจริงต่างกันได้',
      setup: 'ผ่อนปากให้อ้าเล็กน้อย แล้ววางลิ้นค่อนกลางและค่อนต่ำ',
      mistake: 'อย่าบังคับใช้ตำแหน่งสระหลังตามแผนภูมิ IPA ทุกครั้ง สระ cup ในอังกฤษหลายสำเนียงอยู่ค่อนไปกลาง',
      other: 'ə', otherWord: 'about', note: 'cup เป็นพยางค์เน้น ส่วน /ə/ ใน about เป็นสระเบา คุณภาพอาจใกล้กันตามสำเนียง'},
    {phone: 'ə', word: 'about', pos: 'central', mouth: 'ผ่อนริมฝีปาก ไม่ต้องห่อหรือกางชัด',
      tongue: 'วางลิ้นสบาย ๆ ใกล้กลางปาก ไม่แตะเพดาน', setup: 'ผ่อนปากและลิ้นไว้กลาง ๆ',
      mistake: 'ในภาษาอังกฤษ /ə/ มักอยู่พยางค์ไม่เน้น เช่นต้น about อย่าลากหรือเน้นให้เท่าพยางค์หลัก',
      other: 'ʌ', otherWord: 'cup', note: 'ลองฟังสระเบาต้น about เทียบกับสระในพยางค์เน้น cup'},
    {phone: 'ɐ', word: 'about', pos: 'central', mouth: 'ผ่อนริมฝีปากและเปิดปากมากกว่า /ə/ เล็กน้อย',
      tongue: 'ลิ้นอยู่กลางปากค่อนต่ำ ต่ำกว่าท่า /ə/', setup: 'เริ่มจากท่า /ə/ แล้วผ่อนลิ้นต่ำลงเล็กน้อย',
      mistake: 'เป็นรูปเสียงที่อาจพบในสระเบาหรือ cup ตามสำเนียง ให้ฟังคำตัวอย่าง ไม่ใช้คำว่า about แทนทุกบริบท',
      other: 'ə', otherWord: 'about', note: '/ɐ/ ลิ้นต่ำกว่า /ə/ ใน IPA แบบละเอียด'},
    {phone: 'ɜː', word: 'bird', pos: 'central', mouth: 'เปิดปากปานกลาง ไม่ห่อริมฝีปาก',
      tongue: 'ค้างลิ้นใกล้กลางปากระดับกลาง ไม่เลื่อนเข้า /ɹ/ ในสำเนียงตัวอย่าง', setup: 'วางลิ้นกลางปากและไม่ห่อริมฝีปาก',
      mistake: 'ใช้กับ bird แบบไม่ออกเสียง r ท้ายสระ รูปเสียงแบบอเมริกันที่มี r ต้องดูคู่มืออีกแบบ',
      other: 'ə', otherWord: 'about', note: 'bird ใช้สระเน้นและยาวกว่า ส่วนต้น about เป็นสระเบา'},
    {phone: 'a', word: 'time', pos: 'front-low', mouth: 'อ้าปากกว้าง ไม่ห่อริมฝีปาก',
      tongue: 'ลิ้นต่ำค่อนไปด้านหน้าหรือกลางตามสำเนียง', setup: 'อ้าปากวางลิ้นต่ำ ไม่ห่อริมฝีปาก',
      mistake: 'time มีสระเลื่อน /aɪ/ ต่อไปด้วย ตัว /a/ นี้เป็นเพียงจุดเริ่ม ไม่ใช่คำเต็ม',
      other: 'aɪ', otherWord: 'time', note: '/aɪ/ เลื่อนจากจุดเริ่มต่ำนี้ไปสระที่ลิ้นสูงขึ้น'},
    {phone: 'o', word: 'go', pos: 'back-mid', rounded: true, mouth: 'ห่อริมฝีปากและเปิดปากปานกลางค่อนแคบ',
      tongue: 'ลิ้นด้านหลังระดับกลางค่อนสูง ไม่แตะเพดาน', setup: 'ห่อปากและยกลิ้นด้านหลังระดับกลาง',
      mistake: 'go ในหลายสำเนียงมีเสียงเลื่อน /oʊ/ หรือ /əʊ/ ด้วย อย่าหยุดที่จุดเริ่มเมื่อฝึกทั้งคำ',
      other: 'oʊ', otherWord: 'go', note: '/oʊ/ เลื่อนลิ้นและรูปปากต่อจาก /o/'}
  ];
  for (const v of vowels) {
    add(v.phone, {
      category: 'สระ — ทางปากเปิด', place: 'ตำแหน่งลิ้นในช่องปาก ไม่มีจุดแตะปิดทางลม',
      manner: 'ให้เสียงก้องผ่านปากที่เปิด โดยเปลี่ยนคุณภาพสระด้วยตำแหน่งลิ้นและรูปริมฝีปาก',
      voice: voiced, airflow: oralAir + ' ไม่ถูกปิดหรือบีบให้เสียดสี', lips: v.mouth, tongue: v.tongue, canSustain: true,
      steps: [v.setup, 'ทำเสียงก้องสบาย ๆ โดยลิ้นไม่แตะปิดทางลม; ' + throatCheck,
        'ฟังสระเป้าหมายใน ' + v.word + ' แล้วลองค้างสั้น ๆ ก่อนพูดทั้งคำ',
        'เทียบกับ /' + v.other + '/ ใน ' + v.otherWord + ': ' + v.note],
      commonMistake: v.mistake, compare: pair(v.other, v.otherWord, v.note),
      visual: picture('vowel', v.pos, true, false, v.rounded ? 'rounded' : 'unrounded', {manner: 'vowel'}),
      sources: [v.source || SOURCES.vowels, SOURCES.ipa]
    });
  }

  for (const d of [
    {phone: 'eɪ', word: 'day', from: 'front-mid', to: 'front-high', round: false, endRound: false,
      lips: 'เริ่มไม่ห่อปาก แล้วขยับให้ช่องปากแคบลงเล็กน้อย',
      tongue: 'เริ่มลิ้นส่วนหน้าระดับกลาง แล้วเลื่อนสูงขึ้นเข้าหา /ɪ/',
      start: 'วางลิ้นส่วนหน้าระดับกลางและไม่ห่อปาก', move: 'ค่อยเลื่อนลิ้นสูงขึ้นเข้าหา /ɪ/ ให้เสียงต่อกัน',
      other: 'ɛ', otherWord: 'bed', note: '/eɪ/ มีการเลื่อนคุณภาพสระ แต่ /ɛ/ ใน bed ค้างตำแหน่งมากกว่า'},
    {phone: 'aɪ', word: 'time', from: 'front-low', to: 'front-high', round: false, endRound: false,
      lips: 'เริ่มอ้าปาก แล้วค่อยเปิดแคบลงโดยไม่ห่อ', tongue: 'เริ่มลิ้นต่ำด้านหน้าหรือกลาง แล้วเลื่อนสูงขึ้นไปด้านหน้า',
      start: 'อ้าปากและวางลิ้นต่ำ ไม่ห่อปาก', move: 'เลื่อนลิ้นสูงขึ้นเข้าหา /ɪ/ อย่างต่อเนื่อง',
      other: 'aʊ', otherWord: 'now', note: '/aɪ/ จบโดยไม่ห่อปาก ส่วน /aʊ/ จบด้วยปากห่อ'},
    {phone: 'ɔɪ', word: 'boy', from: 'back-mid', to: 'front-high', round: true, endRound: false,
      lips: 'เริ่มห่อปาก แล้วคลายไม่ห่อขณะจบเสียง', tongue: 'เริ่มลิ้นค่อนไปด้านหลังระดับกลาง แล้วเลื่อนมาด้านหน้าและสูงขึ้น',
      start: 'ห่อปากและวางลิ้นด้านหลังระดับกลาง', move: 'คลายปากพร้อมเลื่อนลิ้นมาด้านหน้าเข้าหา /ɪ/',
      other: 'ɔ', otherWord: 'thought', note: '/ɔɪ/ มีการเลื่อนต่อไป ไม่หยุดค้างที่เสียงเริ่ม /ɔ/'},
    {phone: 'aʊ', word: 'now', from: 'front-low', to: 'back-high', round: false, endRound: true,
      lips: 'เริ่มอ้าปาก แล้วค่อยห่อริมฝีปาก', tongue: 'เริ่มลิ้นต่ำด้านหน้าหรือกลาง แล้วเลื่อนสูงค่อนไปด้านหลัง',
      start: 'อ้าปากและวางลิ้นต่ำ', move: 'ค่อยห่อปากพร้อมยกลิ้นสูงขึ้นเข้าหา /ʊ/',
      other: 'aɪ', otherWord: 'time', note: '/aʊ/ เลื่อนเข้าปากห่อ ต่างจาก /aɪ/ ที่จบไม่ห่อปาก'},
    {phone: 'oʊ', word: 'go', from: 'back-mid', to: 'back-high', round: true, endRound: true,
      lips: 'เริ่มห่อปากเล็กน้อย แล้วขยับให้ห่อและแคบขึ้น', tongue: 'เริ่มลิ้นด้านหลังระดับกลาง แล้วเลื่อนสูงขึ้นเข้าหา /ʊ/',
      start: 'ห่อปากเล็กน้อยและวางลิ้นด้านหลังระดับกลาง', move: 'เลื่อนลิ้นสูงขึ้นและห่อปากต่อเนื่อง',
      other: 'əʊ', otherWord: 'go', note: 'go แบบอเมริกันกับอังกฤษอาจมีตำแหน่งเริ่มต่างกัน เลือกตามเสียงตัวอย่าง'},
    {phone: 'əʊ', word: 'go', from: 'central', to: 'back-high', round: false, endRound: true,
      lips: 'เริ่มผ่อนปาก แล้วค่อยห่อริมฝีปาก', tongue: 'เริ่มลิ้นใกล้กลางปาก แล้วเลื่อนสูงขึ้นค่อนไปด้านหลัง',
      start: 'ผ่อนปากและวางลิ้นกลาง ๆ', move: 'ค่อยห่อปากพร้อมยกลิ้นสูงขึ้นเข้าหา /ʊ/',
      other: 'oʊ', otherWord: 'go', note: 'รูปเริ่มของ go ต่างกันตามสำเนียง ไม่ต้องทำสองรูปพร้อมกัน'},
    {phone: 'ɪə', word: 'near', from: 'front-mid', to: 'central', round: false, endRound: false,
      lips: 'เริ่มไม่ห่อปาก แล้วผ่อนริมฝีปาก', tongue: 'เริ่มลิ้นค่อนหน้าและค่อนสูง แล้วผ่อนเข้ากลางปาก',
      start: 'เริ่มสระคล้าย /ɪ/ ใน sit', move: 'ผ่อนลิ้นเข้ากลางปากเป็นเสียงเดียว ไม่เติม /ɹ/',
      other: 'ɪ', otherWord: 'sit', note: 'near ในบางสำเนียงมีการเลื่อนเข้ากลาง บางสำเนียงใช้สระค้างหรือมี /ɹ/'},
    {phone: 'eə', word: 'hair', from: 'front-mid', to: 'central', round: false, endRound: false,
      lips: 'เริ่มเปิดปากปานกลางไม่ห่อ แล้วผ่อนปาก', tongue: 'เริ่มลิ้นด้านหน้าระดับกลาง แล้วผ่อนเข้ากลางปาก',
      start: 'วางลิ้นด้านหน้าระดับกลาง เปิดปากปานกลาง', move: 'ผ่อนลิ้นเข้ากลางปากต่อเนื่องกัน',
      other: 'ɛ', otherWord: 'bed', note: 'hair บางสำเนียงเลื่อนสระ บางสำเนียงค้างสระหรือมี /ɹ/ ให้ฟังต้นแบบ'},
    {phone: 'ʊə', word: 'pure', from: 'back-mid', to: 'central', round: true, endRound: false,
      lips: 'เริ่มห่อปากเล็กน้อย แล้วคลายปาก', tongue: 'เริ่มลิ้นค่อนไปด้านหลังและค่อนสูง แล้วผ่อนเข้ากลางปาก',
      start: 'เริ่มคล้าย /ʊ/ โดยห่อปากเล็กน้อย', move: 'คลายปากพร้อมผ่อนลิ้นเข้ากลางปาก',
      other: 'ʊ', otherWord: 'book', note: 'pure มีรูปสระต่างกันมากตามสำเนียง คู่มือนี้ใช้เฉพาะรูป /ʊə/ ที่แสดง'}
  ]) {
    add(d.phone, {
      category: 'สระเลื่อน — ขยับปากในพยางค์เดียว', place: 'ตำแหน่งลิ้นเคลื่อนภายในช่องปาก ไม่แตะปิด',
      manner: 'เปลี่ยนคุณภาพสระจากจุดเริ่มไปจุดจบอย่างต่อเนื่องในพยางค์เดียว', voice: voiced,
      airflow: oralAir + ' ต่อเนื่องระหว่างเลื่อนสระ', lips: d.lips, tongue: d.tongue, canSustain: true,
      steps: [d.start, d.move, 'ทำสองตำแหน่งต่อกันในพยางค์เดียว ไม่หยุดหรือเติมพยางค์กลาง',
        'ฟัง ' + d.word + ' แล้วลองเลื่อนช้า ๆ ก่อนกลับไปพูดด้วยความเร็วปกติ'],
      commonMistake: 'อย่าแยกเป็นสองพยางค์หรือค้างเฉพาะจุดเริ่ม การเลื่อนและระยะเสียงจริงเปลี่ยนได้ตามสำเนียง',
      compare: pair(d.other, d.otherWord, d.note),
      visual: picture('vowel', d.from, true, false, d.round ? 'rounded' : 'unrounded',
        {manner: 'diphthong', tongueTo: d.to, lipsTo: d.endRound ? 'rounded' : 'unrounded', moving: true}),
      sources: [SOURCES.diphthongs, SOURCES.vowels, SOURCES.ipa]
    });
  }

  // Deliberately do not split an unlisted composite or erase unknown diacritics.
  // The existing phone-guide can provide word-context guidance for those units.
  function normalize(phone) {
    if (typeof phone !== 'string' || phone.length > 64 || /[<>&\u0000-\u001f]/.test(phone)) return '';
    return phone.normalize('NFC').trim().replace(/^[/\[\]]+|[/\[\]]+$/g, '')
      .replace(/[ˈˌ\u0361\u035c]/g, '').replace(/g/g, 'ɡ')
      .replace(/ʧ/g, 'tʃ').replace(/ʤ/g, 'dʒ').replace(/:/g, 'ː').trim();
  }
  function unknown(symbol) {
    return {symbol, known: false, category: 'ยังไม่มีขั้นตอนละเอียดสำหรับหน่วยเสียงนี้',
      place: 'ยังไม่ระบุ', manner: 'ยังไม่ระบุ', voice: 'ยังไม่ระบุ', airflow: 'ยังไม่ระบุ',
      lips: 'ดูคำแนะนำเสียงในคำเต็มประกอบ', tongue: 'ไม่เดาตำแหน่งลิ้นจากตัวเขียน', canSustain: null,
      steps: ['ฟังคำเต็มและดูคำแนะนำเสียงเดิมประกอบ', 'เลือกหน่วยเสียงที่มีคู่มือแยกเพื่อฝึกทีละเสียง',
        'รูปถอดเสียงหรือสำเนียงนี้อาจต้องมีคำอธิบายเฉพาะเพิ่ม'],
      commonMistake: 'อย่าแยกสัญลักษณ์เป็นชื่ออักษรหรือใช้ภาพปากของเสียงอื่นแทน', compare: null, visual: null, sources: []};
  }
  function describe(phone) {
    const symbol = normalize(phone);
    if (!Object.hasOwn(ENTRIES, symbol)) return unknown(symbol);
    // A renderer is allowed to annotate its copy without corrupting later calls.
    return JSON.parse(JSON.stringify(ENTRIES[symbol]));
  }
  return Object.freeze({describe});
});
