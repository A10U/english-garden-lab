/* Original Thai beginner explanations; no third-party audio or charts copied.
 * Articulation/symbol facts checked against these primary educational sources:
 * https://www.internationalphoneticassociation.org/content/ipa-chart-projects
 * https://enunciate.arts.ubc.ca/i/
 * https://enunciate.arts.ubc.ca/%C9%AA/
 * https://enunciate.arts.ubc.ca/2016/04/07/33/
 * https://elc.polyu.edu.hk/CILL/ipa.aspx
 * https://www.teachingenglish.org.uk/teaching-resources/teaching-secondary/teaching-tools/phonemic-chart-english-teachers
 *
 * Examples are English WORDS for contextual listening, not recordings of an
 * isolated exact phone. Vowels and rhoticity vary by accent. No Thai spelling
 * is offered as a supposedly equivalent English sound.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EGLPhoneGuide = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Each entry is [beginner label, articulation tip, contextual example word].
  const GUIDE = {
    'iː': ['สระของ green', 'ยกลิ้นส่วนหน้าให้สูง ปากกางเล็กน้อย ต่างจาก /ɪ/ ทั้งตำแหน่งลิ้นและระยะเสียง', 'green'],
    'i': ['สระของ happy', 'ยกลิ้นส่วนหน้าให้สูง ไม่ห่อปาก ฟังสระท้ายคำ happy; เครื่องหมายนี้ไม่ได้บอกให้ลากยาว', 'happy'],
    'ɪ': ['สระของ sit', 'ผ่อนลิ้นให้ต่ำและถอยเข้ากลางกว่า /iː/ อย่าเพียงตัดเสียง green ให้สั้นลง', 'sit'],
    'e': ['สระของ bed', 'พจนานุกรมอังกฤษบางเล่มใช้ /e/ กับสระของ bed เปิดปากปานกลาง ลิ้นอยู่ด้านหน้า', 'bed'],
    'ɛ': ['สระของ bed', 'เปิดปากปานกลาง ลิ้นส่วนหน้าอยู่ต่ำกว่าเสียง /ɪ/ ไม่ห่อริมฝีปาก', 'bed'],
    'æ': ['สระของ cat', 'อ้าปากกว้างกว่า bed ลดลิ้นส่วนหน้าลง ริมฝีปากไม่ห่อ', 'cat'],
    'ɑː': ['สระของ father', 'อ้าปากกว้าง ลิ้นอยู่ต่ำและค่อนไปด้านหลัง ไม่ห่อปาก เครื่องหมาย ː บอกเสียงยาว', 'father'],
    'ɑ': ['สระของ father', 'อ้าปากกว้าง ลิ้นต่ำค่อนไปด้านหลัง ไม่ห่อปาก ระยะเสียงขึ้นกับคำและสำเนียง', 'father'],
    'ɔː': ['สระของ thought', 'ห่อปากและยกลิ้นด้านหลังขึ้นจาก /ɑː/ ฟังคำ thought ในสำเนียงที่แยกสระนี้', 'thought'],
    'ɔ': ['สระห่อปากของ thought', 'ลิ้นค่อนไปด้านหลัง ปากเปิดปานกลางและห่อ ระยะเสียงอาจต่างกันตามสำเนียง', 'thought'],
    'ɒ': ['สระของ hot แบบอังกฤษ', 'อ้าปากและห่อริมฝีปาก ลิ้นต่ำค่อนไปด้านหลัง คำ hot แบบอเมริกันอาจใช้สระอื่น', 'hot'],
    'ʊ': ['สระของ book', 'ห่อปากเล็กน้อย ลิ้นผ่อนและต่ำกว่า /uː/ ความต่างจาก food ไม่ใช่แค่ความยาว', 'book'],
    'uː': ['สระของ food', 'ยกลิ้นสูงและห่อปาก ให้สระชัดกว่า book ตำแหน่งลิ้นจริงอาจค่อนไปกลางตามสำเนียง', 'food'],
    'u': ['สระห่อปากแบบ food', 'ยกลิ้นสูงและห่อปาก สัญลักษณ์นี้ไม่ระบุความยาว ฟังเสียงในคำเต็มประกอบ', 'food'],
    'ʌ': ['สระของ cup', 'ผ่อนปากให้อ้าเล็กน้อย ลิ้นอยู่ค่อนกลางและค่อนต่ำ ไม่ห่อปาก', 'cup'],
    'ə': ['สระเบาของ about', 'ปล่อยปากและลิ้นสบาย ๆ ออกเสียงเบาในพยางค์ไม่เน้น เช่นช่วงต้นของ about', 'about'],
    'ɐ': ['สระผ่อนปากแบบ about', 'ผ่อนลิ้นไว้กลางปากแต่ต่ำกว่า /ə/ เล็กน้อย อาจพบในสระเบาหรือสระของ cup ตามสำเนียง', 'about'],
    'ɜː': ['สระของ bird แบบอังกฤษ', 'ค้างลิ้นไว้กลางปาก ริมฝีปากไม่ห่อ ฟัง bird แบบอังกฤษที่ไม่ออกเสียง r ท้ายสระ', 'bird'],
    'ɚ': ['สระเบาที่มีเสียง r', 'ผ่อนสระกลางปากพร้อมยกลิ้นให้มีเสียง r แบบอเมริกัน ฟังท้ายคำ teacher', 'teacher'],
    'ɝ': ['สระเน้นที่มีเสียง r', 'ทำสระกลางปากพร้อมเสียง r โดยลิ้นไม่แตะเพดาน ฟัง bird แบบอเมริกัน', 'bird'],
    'a': ['จุดเริ่มสระของ time', 'เริ่มอ้าปากและวางลิ้นต่ำ ใน time เสียงจะเลื่อนต่อไป ไม่ใช่หยุดอยู่ที่สระนี้', 'time'],
    'o': ['จุดเริ่มสระของ go', 'ลิ้นค่อนไปด้านหลังและห่อปาก ใน go หลายสำเนียงจะเลื่อนสระต่อไป', 'go'],
    'eː': ['สระหน้าที่ค้างยาว', 'ยกลิ้นส่วนหน้าในระดับปานกลางและค้างเสียง บางสำเนียงใช้แทนสระเลื่อนของ day', 'day'],
    'oː': ['สระหลังห่อปากที่ค้างยาว', 'ห่อปากและค้างลิ้นด้านหลัง บางสำเนียงใช้แทนสระเลื่อนของ go', 'go'],
    'eɪ': ['สระเลื่อนของ day', 'เริ่มลิ้นส่วนหน้าระดับกลาง แล้วเลื่อนให้สูงขึ้นในเสียงเดียว ไม่แยกเป็นสองพยางค์', 'day'],
    'aɪ': ['สระเลื่อนของ time', 'เริ่มอ้าปากแล้วค่อยยกลิ้นส่วนหน้าให้สูงขึ้น พูดต่อเนื่องเป็นพยางค์เดียว', 'time'],
    'ɔɪ': ['สระเลื่อนของ boy', 'เริ่มห่อปากแล้วค่อยคลายปาก พร้อมยกลิ้นมาทางด้านหน้า', 'boy'],
    'əʊ': ['สระของ go แบบอังกฤษ', 'เริ่มจากปากผ่อนกลาง ๆ แล้วค่อยห่อปากและยกลิ้นขึ้น พูดต่อกันเป็นเสียงเดียว', 'go'],
    'oʊ': ['สระของ go แบบอเมริกัน', 'เริ่มห่อปากเล็กน้อย แล้วเลื่อนลิ้นสูงขึ้นพร้อมห่อปากต่อเนื่อง', 'go'],
    'aʊ': ['สระเลื่อนของ now', 'เริ่มอ้าปากแล้วค่อยห่อปาก พร้อมยกลิ้นขึ้น อย่าแยกเป็นสองพยางค์', 'now'],
    'ɪə': ['สระของ near บางสำเนียง', 'เริ่มสระแบบ sit แล้วผ่อนลิ้นเข้ากลางปาก near ในสำเนียงที่ออกเสียง r จะต่างออกไป', 'near'],
    'iə': ['สระหน้าเลื่อนเข้ากลาง', 'เริ่มยกลิ้นส่วนหน้าแล้วผ่อนเข้ากลางปาก เป็นรูปถอดเสียงที่อาจพบใน near', 'near'],
    'eə': ['สระของ hair บางสำเนียง', 'เริ่มสระหน้าปากแล้วผ่อนเข้ากลางปาก hair อาจเป็นสระค้างหรือมีเสียง r ตามสำเนียง', 'hair'],
    'ʊə': ['สระของ pure บางสำเนียง', 'เริ่มห่อปากเล็กน้อยแล้วผ่อนลิ้นเข้ากลางปาก คำนี้มีรูปสระต่างกันได้หลายสำเนียง', 'pure'],
    'p': ['เสียงต้นของ pen', 'ปิดริมฝีปากทั้งสองแล้วปล่อยลม ช่วงต้นคำที่เน้นมักมีลมตาม อย่าเติมสระท้ายเสียง', 'pen'],
    'b': ['เสียงต้นของ bed', 'ปิดริมฝีปากทั้งสองแล้วเปิด พร้อมใช้เสียงจากลำคอ ต่างจากลมของ /p/', 'bed'],
    't': ['เสียงต้นของ tea', 'แตะปลายลิ้นที่ปุ่มเหงือกหลังฟันบนแล้วปล่อยลม ไม่ต้องเติมสระท้าย', 'tea'],
    'd': ['เสียงต้นของ day', 'แตะปลายลิ้นที่ปุ่มเหงือกหลังฟันบนแล้วปล่อย พร้อมใช้เสียงจากลำคอ', 'day'],
    'k': ['เสียงต้นของ key', 'ยกโคนลิ้นแตะเพดานอ่อนด้านหลังแล้วปล่อยลม ปลายลิ้นไม่ต้องแตะฟัน', 'key'],
    'ɡ': ['เสียงต้นของ green', 'ยกโคนลิ้นแตะเพดานอ่อนแล้วปล่อย พร้อมใช้เสียงจากลำคอ', 'green'],
    'f': ['เสียงต้นของ fan', 'ให้ฟันบนแตะริมฝีปากล่างเบา ๆ แล้วเป่าลมต่อเนื่อง ลำคอไม่สั่น', 'fan'],
    'v': ['เสียงต้นของ van', 'วางฟันบนกับริมฝีปากล่างเหมือน /f/ แต่เพิ่มเสียงให้ลำคอสั่น', 'van'],
    'θ': ['เสียง th ของ thin', 'วางปลายลิ้นแตะฟันหรือระหว่างฟันเบา ๆ แล้วเป่าลมต่อเนื่อง ลำคอไม่สั่น', 'thin'],
    'ð': ['เสียง th ของ this', 'วางลิ้นเหมือน /θ/ แล้วเพิ่มเสียงให้ลำคอสั่น เปรียบเทียบ thin กับ this', 'this'],
    's': ['เสียงต้นของ sun', 'ให้ลมผ่านช่องแคบใกล้ปุ่มเหงือกหลังฟันบน ลำคอไม่สั่น', 'sun'],
    'z': ['เสียงต้นของ zoo', 'วางลิ้นและปล่อยลมเหมือน /s/ แต่เพิ่มเสียงให้ลำคอสั่น', 'zoo'],
    'ʃ': ['เสียงต้นของ ship', 'ยกลิ้นใกล้บริเวณถัดหลังปุ่มเหงือก ห่อปากเล็กน้อยแล้วปล่อยลม ลำคอไม่สั่น', 'ship'],
    'ʒ': ['เสียงกลางของ vision', 'วางลิ้นคล้าย /ʃ/ แต่เพิ่มเสียงให้ลำคอสั่น ฟังเสียงกลางคำ vision', 'vision'],
    'tʃ': ['เสียงต้นของ chair', 'กั้นลมด้วยลิ้นแล้วปล่อยเป็นลมเสียดสีคล้าย /ʃ/ ต่อเนื่องกัน ลำคอไม่สั่น', 'chair'],
    'dʒ': ['เสียงต้นของ job', 'กั้นลมแล้วปล่อยเป็นเสียงเสียดสีต่อเนื่อง คล้าย /tʃ/ แต่ใช้เสียงให้ลำคอสั่น', 'job'],
    'm': ['เสียงต้นของ moon', 'ปิดริมฝีปากและให้เสียงออกทางจมูก ลองแตะจมูกเบา ๆ เพื่อสังเกตการสั่น', 'moon'],
    'n': ['เสียงต้นของ night', 'แตะปลายลิ้นหลังฟันบนและให้เสียงออกทางจมูก ริมฝีปากเปิดได้', 'night'],
    'ŋ': ['เสียงท้ายของ sing', 'ยกโคนลิ้นแตะเพดานอ่อนและให้เสียงออกทางจมูก ใน sing ไม่ต้องเติม /ɡ/ ท้าย', 'sing'],
    'h': ['เสียงต้นของ hat', 'เปิดทางลมแล้วผ่อนลมหายใจออก เตรียมรูปปากให้เข้ากับสระที่ตามมา', 'hat'],
    'l': ['เสียงต้นของ leaf', 'แตะปลายลิ้นที่ปุ่มเหงือกหลังฟันบน ให้ลมผ่านข้างลิ้นและใช้เสียงจากลำคอ', 'leaf'],
    'ɹ': ['เสียง r ของ red', 'ยกลิ้นโดยไม่แตะเพดาน อาจรวบลิ้นหรือม้วนปลายเล็กน้อย ไม่ต้องรัวลิ้น', 'red'],
    'r': ['สัญลักษณ์ r: ดูบริบท', 'พจนานุกรมอังกฤษมักใช้ r แทนเสียงของ red แต่ IPA แบบละเอียดใช้ /r/ หมายถึงลิ้นรัว ให้ฟังคำเต็มประกอบ', 'red'],
    'w': ['เสียงต้นของ water', 'ห่อริมฝีปากพร้อมยกโคนลิ้น แล้วคลายเข้าหาสระอย่างรวดเร็ว ฟันไม่แตะริมฝีปาก', 'water'],
    'j': ['เสียงต้นของ yes', 'ยกลิ้นส่วนหน้าสูงใกล้เพดาน แล้วเลื่อนไปสระที่ตามมา สัญลักษณ์ j ไม่ใช่เสียงต้นของ job', 'yes'],
    'ɫ': ['เสียง l ท้ายคำแบบ milk', 'ให้ปลายลิ้นแตะหลังฟันบน พร้อมยกลิ้นด้านหลังขึ้น ฟังเสียง l ใน milk', 'milk'],
    'ɾ': ['เสียงลิ้นแตะเร็วของ water', 'ปลายลิ้นแตะปุ่มเหงือกเพียงครั้งเดียวอย่างเร็ว อาจได้ยินแทน t หรือ d แบบอเมริกัน', 'water'],
    'əl': ['สระเบาต่อเสียง l', 'เริ่มสระผ่อนกลางปากแล้วแตะปลายลิ้นเป็น /l/ ฟังท้ายคำ bottle', 'bottle'],
    'l̩': ['เสียง l ที่เป็นพยางค์', 'ให้เสียงไหลข้างลิ้นเป็นแกนพยางค์โดยไม่ต้องเติมสระชัด ๆ อาจได้ยินท้าย bottle', 'bottle'],
    'n̩': ['เสียง n ที่เป็นพยางค์', 'ให้เสียงออกทางจมูกเป็นแกนพยางค์โดยไม่ต้องเติมสระชัด ๆ อาจได้ยินท้าย button', 'button'],
    'ɑːɹ': ['สระต่อเสียง r ของ car', 'อ้าปากทำสระด้านหลังแล้วเลื่อนลิ้นเข้าเสียง /ɹ/ อย่างต่อเนื่อง ฟัง car แบบอเมริกัน', 'car'],
    'ɑɹ': ['สระต่อเสียง r ของ car', 'เริ่มสระอ้าปากด้านหลังแล้วเลื่อนเข้าเสียง /ɹ/ ไม่แยกเป็นสองพยางค์', 'car'],
    'ɔːɹ': ['สระต่อเสียง r ของ four', 'เริ่มสระห่อปากแล้วเลื่อนลิ้นเข้าเสียง /ɹ/ ฟัง four ในสำเนียงที่ออกเสียง r', 'four'],
    'ɔɹ': ['สระห่อปากต่อเสียง r', 'เริ่มสระห่อปากแล้วเลื่อนเข้าเสียง /ɹ/ อย่างต่อเนื่อง ฟัง four แบบอเมริกัน', 'four'],
    'oːɹ': ['สระห่อปากยาวต่อเสียง r', 'ค้างสระห่อปากแล้วเลื่อนเข้าเสียง /ɹ/ เป็นรูปถอดเสียงที่อาจพบใน four', 'four'],
    'ɪɹ': ['สระต่อเสียง r ของ near', 'เริ่มสระด้านหน้าแล้วเลื่อนลิ้นเข้าเสียง /ɹ/ ฟัง near แบบอเมริกัน', 'near'],
    'ɛɹ': ['สระต่อเสียง r ของ hair', 'เปิดปากทำสระด้านหน้าแล้วเลื่อนลิ้นเข้าเสียง /ɹ/ อย่างต่อเนื่อง', 'hair'],
    'ʊɹ': ['สระห่อปากต่อเสียง r', 'เริ่มห่อปากเล็กน้อยแล้วเลื่อนเข้าเสียง /ɹ/ เช่น tour บางสำเนียง', 'tour'],
    'aɪɚ': ['สระเลื่อนต่อเสียง r ของ fire', 'เริ่มอ้าปาก เลื่อนลิ้นสูงขึ้น แล้วเข้าสระที่มีเสียง r จำนวนพยางค์อาจต่างตามสำเนียง', 'fire'],
    'aʊɚ': ['สระเลื่อนต่อเสียง r ของ flower', 'เริ่มอ้าปาก ค่อยห่อปาก แล้วเข้าสระที่มีเสียง r ฟังคำเต็มอย่างต่อเนื่อง', 'flower']
  };

  const KEYS = Object.keys(GUIDE).sort((a, b) => b.length - a.length);
  const PRACTICE_DISCLAIMER = 'เป็นแนวทางฝึกทั่วไปตามเสียงอ้างอิงที่ส่งมา ไม่ได้ชี้ว่าคุณออกเสียงส่วนใดผิด และไม่ได้ยืนยันคำอ่านของคำใหม่';
  const PRACTICE_SOURCES = {
    ipa: 'https://www.internationalphoneticassociation.org/content/ipa-chart-projects',
    chart: 'https://www.teachingenglish.org.uk/teaching-resources/teaching-secondary/teaching-tools/phonemic-chart-english-teachers',
    w: 'https://enunciate.arts.ubc.ca/w/',
    labialVelar: 'https://www.internationalphoneticassociation.org/IPAcharts/IPA_charts_EI/IPA_charts_EI.html',
    smallI: 'https://enunciate.arts.ubc.ca/%C9%AA/',
    theta: 'https://enunciate.arts.ubc.ca/2016/04/07/33/',
    eth: 'https://enunciate.arts.ubc.ca/2016/04/07/34/',
    withOxford: 'https://www.oxfordlearnersdictionaries.com/definition/english/with?q=with',
    withCambridge: 'https://dictionary.cambridge.org/us/dictionary/english/with'
  };

  function normalize(phone) {
    if (typeof phone !== 'string' || phone.length > 64) return '';
    return phone.normalize('NFC').trim().replace(/^[/\[\]]+|[/\[\]]+$/g, '')
      .replace(/[ˈˌ\u0361\u035c]/g, '').replace(/g/g, 'ɡ')
      .replace(/ʧ/g, 'tʃ').replace(/ʤ/g, 'dʒ').trim();
  }

  function fallback(symbol) {
    return {symbol, label: 'ยังไม่มีคู่มือเสียงนี้',
      tip: 'ฟังคำเต็มและดูสัญลักษณ์ประกอบ หน่วยเสียงนี้อาจเป็นรูปถอดเสียงหรือเสียงจากสำเนียงอื่น', example: ''};
  }

  function describe(phone) {
    const symbol = normalize(phone);
    if (Object.hasOwn(GUIDE, symbol)) {
      const [label, tip, example] = GUIDE[symbol];
      return {symbol, label, tip, example};
    }
    // Longest known PHONE units first, never split affricates/length marks
    // into letters. Unknown diacritics remain unknown instead of being erased.
    const parts = [];
    let position = 0;
    while (position < symbol.length && parts.length < 4) {
      const key = KEYS.find(candidate => symbol.startsWith(candidate, position));
      if (!key) return fallback(symbol);
      parts.push(key);
      position += key.length;
    }
    if (parts.length < 2 || position !== symbol.length) return fallback(symbol);
    return {symbol,
      label: `เสียงต่อกัน ${parts.map(part => `/${part}/`).join(' → ')}`,
      tip: parts.map(part => `/${part}/: ${GUIDE[part][1]}`).join(' แล้วจึง ') + ' ฝึกต่อกันในคำเต็ม',
      // A guessed example could contain only the first part. Leave it empty.
      example: ''};
  }

  // This supplies general exercises for a reference provided by the caller.
  // It does not recognize speech, validate new words or locate learner errors.
  function practiceForWord(text, phones) {
    const word = typeof text === 'string' ? text.trim() : '';
    const unavailable = () => ({available: false, word, steps: [], acceptedPronunciations: [], variantNote: '', sources: [],
      disclaimer: PRACTICE_DISCLAIMER + ' · ยังไม่มีคำแนะนำที่อ้างอิงได้สำหรับข้อมูลนี้'});
    if (!word || word.length > 80 || !/^[a-z]+(?:['’‘-][a-z]+)*$/i.test(word)
      || !Array.isArray(phones) || !phones.length || phones.length > 64) return unavailable();
    const symbols = Array.from(phones, normalize);
    // Only authored single entries are suitable for individual practice steps.
    // describe() can explain some composites, but it must not invent a lesson.
    if (symbols.some(symbol => !Object.hasOwn(GUIDE, symbol))) return unavailable();
    const isWith = word.toLowerCase() === 'with' && symbols.length === 3 && symbols[0] === 'w' && symbols[1] === 'ɪ'
      && (symbols[2] === 'ð' || symbols[2] === 'θ');
    const sources = new Set([PRACTICE_SOURCES.ipa, PRACTICE_SOURCES.chart]);
    symbols.forEach(symbol => {
      if (symbol === 'w') { sources.add(PRACTICE_SOURCES.w); sources.add(PRACTICE_SOURCES.labialVelar); }
      if (symbol === 'ɪ') sources.add(PRACTICE_SOURCES.smallI);
      if (symbol === 'θ') sources.add(PRACTICE_SOURCES.theta);
      if (symbol === 'ð') sources.add(PRACTICE_SOURCES.eth);
    });
    const steps = symbols.map((phone, phoneIndex) => {
      const fact = describe(phone);
      return {phoneIndex, phone,
        instruction: fact.tip + ' แล้วลองเชื่อมกลับเป็นคำ ' + word + ' ตามเสียงอ้างอิงที่เลือก',
        selfCheck: 'ฟังเสียง /' + phone + '/ ในคำตัวอย่าง แล้วฟังคำของคุณเทียบกัน คุณสังเกตความใกล้เคียงได้หรือยัง หากยังไม่แน่ใจเลือกยังไม่แน่ใจหรือฟังใหม่ได้',
        examples: [{text: fact.example, label: 'ฟัง /' + phone + '/ ในคำเต็ม ' + fact.example}]};
    });
    let variantNote = '';
    if (isWith) {
      sources.add(PRACTICE_SOURCES.withOxford); sources.add(PRACTICE_SOURCES.withCambridge);
      sources.add(PRACTICE_SOURCES.theta); sources.add(PRACTICE_SOURCES.eth);
      steps[0] = {phoneIndex: 0, phone: 'w',
        instruction: 'ห่อริมฝีปากเล็กน้อยพร้อมยกส่วนหลังของลิ้น แล้วคลายเข้าหาสระ /ɪ/ ต่อเนื่องเป็นคำ with ไม่แยกเสียงต้นเป็นอีกพยางค์',
        selfCheck: 'ลองสังเกตในกระจกว่าริมฝีปากเริ่มห่อแล้วคลายเข้าสระต่อเนื่องหรือยัง โดยฟันไม่แตะริมฝีปากล่าง หรือฟังเสียงต้นเทียบคำตัวอย่าง',
        examples: [{text: 'water', label: 'ฟัง /w/ ที่ต้นคำเต็ม water'}]};
      steps[1] = {phoneIndex: 1, phone: 'ɪ',
        instruction: 'วางลิ้นค่อนหน้าและค่อนสูง แต่ผ่อนต่ำและเข้ากลางกว่า /iː/ ไม่ห่อปาก ฟัง sit เทียบ seat โดยสังเกตคุณภาพสระ ไม่ใช้ความยาวอย่างเดียว',
        selfCheck: 'ฟังสระในคำของคุณเทียบ sit แล้วใช้ seat ช่วยฟังความต่าง หากยังแยกคุณภาพสระไม่ออกเลือกยังไม่แน่ใจได้',
        examples: [{text: 'sit', label: 'ฟังคำเต็ม sit: สระ /ɪ/'}, {text: 'seat', label: 'ฟังคำเต็ม seat: สระ /iː/ เพื่อเปรียบเทียบ'}]};
      const final = symbols[2], voiced = final === 'ð';
      steps[2] = {phoneIndex: 2, phone: final,
        instruction: 'วางปลายลิ้นชิดฟันบนเบา ๆ หรือระหว่างฟันเล็กน้อย เหลือช่องให้ลมผ่านต่อเนื่อง ไม่กัดลิ้น แล้วเชื่อมท้ายคำ with ตัวอย่างนี้ใช้ /' + final + '/ ' + (voiced ? 'ที่มีเสียงก้องเบา ๆ' : 'ที่เป็นเสียงลมโดยไม่เพิ่มเสียงก้อง'),
        selfCheck: voiced ? 'ลองแตะด้านหน้าลำคอเบา ๆ เพื่อสังเกตการสั่นขณะทำ /ð/ ไม่ต้องกดหรือเกร็งคอ; /θ/ ก็เป็นรูปที่พจนานุกรมยอมรับใน with'
          : 'ลองฟังเสียงลมของ /θ/ เทียบเสียงก้องของ /ð/ ในคำตัวอย่าง; ทั้งสองรูปใช้ได้ใน with จึงไม่ต้องเปลี่ยนเพียงเพื่อให้เหมือนตัวอย่างนี้',
        examples: voiced ? [{text: 'this', label: 'ฟัง /ð/ ในคำเต็ม this'}, {text: 'thin', label: 'ฟัง /θ/ ในคำเต็ม thin เพื่อเปรียบเทียบ'}]
          : [{text: 'thin', label: 'ฟัง /θ/ ในคำเต็ม thin'}, {text: 'this', label: 'ฟัง /ð/ ในคำเต็ม this เพื่อเปรียบเทียบ'}]};
      variantNote = 'with มีคำอ่าน /wɪð/ และ /wɪθ/ ที่พจนานุกรมระบุทั้งสองแบบ ตัวอย่างนี้ใช้ /wɪ' + final + '/ ไม่ได้หมายความว่าอีกแบบผิด';
    }
    return {available: true, word, steps,
      acceptedPronunciations: isWith ? [['w', 'ɪ', 'ð'], ['w', 'ɪ', 'θ']] : [],
      variantNote, sources: [...sources], disclaimer: PRACTICE_DISCLAIMER};
  }

  return Object.freeze({describe, practiceForWord});
});
